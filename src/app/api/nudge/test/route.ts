import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@/lib/supabase/server"
import { env } from "@/lib/env"
import { generateNudge, generateProductiveWindowNudge } from "@/lib/nim"
import { sendPushNotification } from "@/lib/webpush"
import { getDefaultTimezone, formatClockTime } from "@/lib/time"
import {
  DEADLINE_THRESHOLDS,
  pickDeadlineThreshold,
  formatRemaining,
  buildDeadlineMessage,
  type DeadlineType,
} from "@/lib/deadline"
import { nudgeTestQuerySchema } from "@/lib/validations"
import type { Database } from "@/database.types"
import webpush from "web-push"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const ratelimit = new Ratelimit({
  redis: new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  prefix: "rl:nudge:test",
})

export async function GET(req: NextRequest) {
  // Dev-only tool. Fail CLOSED: any non-development environment 404s, so an
  // unset/misset NODE_ENV can never expose this unauthenticated endpoint.
  if (env.NODE_ENV !== "development") {
    return NextResponse.json({}, { status: 404 })
  }

  // Even in dev: require a session and only let the caller target their own
  // user id — previously anyone passing ?userId= could read another user's
  // assignment titles and trigger pushes to their devices.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { success } = await ratelimit.limit(user.id)
  if (!success) return NextResponse.json({ error: "Too many test requests" }, { status: 429 })

  const parsed = nudgeTestQuerySchema.safeParse({
    userId: req.nextUrl.searchParams.get("userId"),
    type: req.nextUrl.searchParams.get("type") ?? "productive_window",
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid notification test and try again." }, { status: 422 })
  }
  if (parsed.data.userId !== user.id) {
    return NextResponse.json({ error: "Can only trigger test nudges for your own account" }, { status: 403 })
  }
  const { userId, type } = parsed.data

  const serviceClient = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: subs } = await serviceClient
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)

  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: "No push subscription found" }, { status: 400 })
  }

  const now = new Date()

  // ── Overdue nudge ────────────────────────────────────────────────────────────
  if (type === "overdue") {
    const { data: assignment } = await serviceClient
      .from("assignments")
      .select("id, title, due_at, courses(name)")
      .eq("user_id", userId)
      .eq("is_completed", false)
      .lt("due_at", now.toISOString())
      .order("due_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!assignment) {
      return NextResponse.json({ error: "No overdue assignment found" }, { status: 400 })
    }

    const courseName =
      (assignment.courses as { name: string } | null)?.name ?? "Unknown Course"

    const { data: profile } = await serviceClient
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle()
    const userTz = profile?.timezone ?? getDefaultTimezone()

    const nudgeText = await generateNudge(
      assignment.title,
      assignment.due_at ?? now.toISOString(),
      courseName,
      userTz,
    )

    const results: string[] = []
    for (const sub of subs) {
      const subscription: webpush.PushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }
      try {
        await sendPushNotification(subscription, nudgeText, "Overdue Reminder 📌")
        results.push(`✓ ${sub.endpoint.slice(0, 50)}…`)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 410 || statusCode === 404) {
          await serviceClient.from("push_subscriptions").delete().eq("user_id", userId)
            .eq("endpoint", sub.endpoint).eq("p256dh", sub.p256dh).eq("auth", sub.auth)
          results.push(`✗ stale (${statusCode}), deleted`)
        } else {
          results.push(`✗ error: ${String(err)}`)
        }
      }
    }

    const { error: logError } = await serviceClient.from("nudge_logs").upsert(
      {
        user_id: userId,
        assignment_id: assignment.id,
        nudge_type: "overdue",
        sent_at: now.toISOString(),
      },
      { onConflict: "user_id,assignment_id,nudge_type" },
    )

    if (results.some((r) => r.startsWith("✓"))) {
      await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: "overdue" })
    }

    return NextResponse.json({ sent: true, type, assignment: assignment.title, nudge: nudgeText, devices: results, logError: logError?.message ?? null })
  }

  // ── Productive window nudge ──────────────────────────────────────────────────
  if (type === "productive_window") {
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

    const { data: assignments } = await serviceClient
      .from("assignments")
      .select("id, title, due_at, courses(name)")
      .eq("user_id", userId)
      .eq("is_completed", false)
      .gt("due_at", now.toISOString())
      .lt("due_at", fourteenDaysFromNow.toISOString())
      .order("due_at", { ascending: true })
      .limit(5)

    const upcomingList = (assignments ?? []).map((a) => ({
      title: a.title,
      courseName: (a.courses as { name: string } | null)?.name,
      dueAt: a.due_at,
    }))

    // Fetch user's timezone for accurate local time in the nudge text.
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle()
    const userTz = profile?.timezone ?? getDefaultTimezone()

    const nudgeText = await generateProductiveWindowNudge({
      upcomingAssignments: upcomingList,
      totalPendingCount: upcomingList.length,
      userTz,
    })

    // Send to ALL devices for this user.
    const results: string[] = []
    for (const sub of subs) {
      const subscription: webpush.PushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }
      try {
        await sendPushNotification(subscription, nudgeText, "Peak Focus Window ⚡")
        results.push(`✓ ${sub.endpoint.slice(0, 50)}…`)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 410 || statusCode === 404) {
          await serviceClient.from("push_subscriptions").delete().eq("user_id", userId)
            .eq("endpoint", sub.endpoint).eq("p256dh", sub.p256dh).eq("auth", sub.auth)
          results.push(`✗ stale (${statusCode}), deleted`)
        } else {
          results.push(`✗ error: ${String(err)}`)
        }
      }
    }

    const firstAssignment = assignments?.[0]
    const productiveClaim = {
      user_id: userId,
      assignment_id: firstAssignment?.id ?? null,
      nudge_type: "productive_window",
      sent_at: now.toISOString(),
    }
    const { error: productiveLogError } = firstAssignment
      ? await serviceClient.from("nudge_logs").upsert(productiveClaim, { onConflict: "user_id,assignment_id,nudge_type" })
      : await serviceClient.from("nudge_logs").insert(productiveClaim)

    if (results.some((r) => r.startsWith("✓"))) {
      await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: "productive_window" })
    }

    return NextResponse.json({
      sent: true,
      type,
      upcomingCount: upcomingList.length,
      nudge: nudgeText,
      devices: results,
      logError: productiveLogError?.message ?? null,
    })
  }

  // ── Deadline nudge (12h / 6h / 1h) ──────────────────────────────────────────
  const threshold = DEADLINE_THRESHOLDS.find((t) => t.type === type)!

  const { data: upcomingAssignments } = await serviceClient
    .from("assignments")
    .select("id, title, due_at")
    .eq("user_id", userId)
    .eq("is_completed", false)
    .gt("due_at", now.toISOString())
    .lte("due_at", new Date(now.getTime() + threshold.maxMs).toISOString())
    .order("due_at", { ascending: true })

  if (!upcomingAssignments || upcomingAssignments.length === 0) {
    return NextResponse.json({
      sent: false,
      type,
      reason: `No assignments due within the ${type} window`,
    })
  }

  // Dedup: load which deadline buckets already fired for these assignments.
  const assignmentIds = upcomingAssignments.map((a) => a.id)
  const { data: sentLogs } = await serviceClient
    .from("nudge_logs")
    .select("assignment_id, nudge_type")
    .eq("user_id", userId)
    .in("assignment_id", assignmentIds)
    .in("nudge_type", ["12h", "6h", "1h"])

  const sentByAssignment = new Map<string, Set<DeadlineType>>()
  for (const l of sentLogs ?? []) {
    if (!l.assignment_id) continue
    const set = sentByAssignment.get(l.assignment_id) ?? new Set<DeadlineType>()
    set.add(l.nudge_type as DeadlineType)
    sentByAssignment.set(l.assignment_id, set)
  }

  // Only assignments whose current catch-up bucket matches the requested type.
  const toSend = upcomingAssignments.filter((a) => {
    if (!a.due_at) return false
    const picked = pickDeadlineThreshold(
      new Date(a.due_at).getTime() - now.getTime(),
      sentByAssignment.get(a.id) ?? new Set<DeadlineType>(),
    )
    return picked?.type === type
  })

  if (toSend.length === 0) {
    return NextResponse.json({
      sent: false,
      type,
      reason: "No assignments currently hitting this bucket (or already sent)",
    })
  }

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle()
  const userTz = profile?.timezone ?? getDefaultTimezone()

  const earliest = toSend[0]
  const remaining = formatRemaining(new Date(earliest.due_at!).getTime() - now.getTime())
  const clockLabel = toSend.length === 1
    ? `(by ${formatClockTime(new Date(earliest.due_at!), userTz)})`
    : undefined
  const message = buildDeadlineMessage(
    toSend.map((a) => ({ title: a.title, dueAt: a.due_at })),
    remaining,
    clockLabel,
  )
  const notifTitle = `Due in ${remaining} ${threshold.icon}`

  // Send to ALL devices for this user.
  const results: string[] = []
  for (const sub of subs) {
    const subscription: webpush.PushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    }
    try {
      await sendPushNotification(subscription, message, notifTitle)
      results.push(`✓ ${sub.endpoint.slice(0, 50)}…`)
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode
      if (statusCode === 410 || statusCode === 404) {
        await serviceClient.from("push_subscriptions").delete().eq("user_id", userId)
          .eq("endpoint", sub.endpoint).eq("p256dh", sub.p256dh).eq("auth", sub.auth)
        results.push(`✗ stale (${statusCode}), deleted`)
      } else {
        results.push(`✗ error: ${String(err)}`)
      }
    }
  }

  const { error: deadlineLogError } = await serviceClient.from("nudge_logs").upsert(
    toSend.map((a) => ({
      user_id: userId,
      assignment_id: a.id,
      nudge_type: type,
      sent_at: now.toISOString(),
    })),
    { onConflict: "user_id,assignment_id,nudge_type", ignoreDuplicates: true },
  )

  if (results.some((r) => r.startsWith("✓"))) {
    await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: type })
  }

  return NextResponse.json({
    sent: true,
    type,
    assignments: toSend.map((a) => a.title),
    title: notifTitle,
    message,
    devices: results,
    logError: deadlineLogError?.message ?? null,
  })
}

