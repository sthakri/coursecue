import { queue, schedules } from "@trigger.dev/sdk"
import { createServerClient } from "@supabase/ssr"
import { env } from "@/lib/env"
import { generateProductiveWindowNudge } from "@/lib/nim"
import { sendPushNotification } from "@/lib/webpush"
import { getLocalHour, getLocalDay, getDefaultTimezone, formatClockTime, coerceTimezone, COMPLETED_RETENTION_DAYS } from "@/lib/time"
import {
  pickDeadlineThreshold,
  formatRemaining,
  buildDeadlineMessage,
  type DeadlineType,
  type DeadlineThreshold,
} from "@/lib/deadline"
import type { Database } from "@/database.types"
import webpush from "web-push"
import ws from "ws"

import { filterDailyOverdueNudge, filterNeverNudgedOverdue, overdueReminderTtl, OVERDUE_REMINDER_WINDOW_MS } from "@/lib/overdue-dedup";
import { isActiveSlot } from "@/lib/ml";
export { filterDailyOverdueNudge, filterNeverNudgedOverdue };

function isInQuietHours(
  start: number | null,
  end: number | null,
  localHour: number,
): boolean {
  if (start === null || end === null) return false
  if (start === end) return false // equal start/end = "off", not "quiet for one hour"
  if (start < end) return localHour >= start && localHour < end
  return localHour >= start || localHour < end
}

// Serial queue: the 15-min cron can otherwise overlap with a long-running
// previous run (NIM timeouts are 30s each), and the claim-then-send dedup only
// holds if exactly one run is in flight at a time.
const nudgeQueue = queue({ name: "nudge-engine", concurrencyLimit: 1 })

// ─────────────────────────────────────────────────────────────────────────────

export const nudgeEngine = schedules.task({
  id: "send-nudges",
  cron: "*/15 * * * *", // every 15 min (UTC) — deadline nudges land within ~15 min of intended time
  queue: nudgeQueue,
  run: async () => {
    if (env.NUDGE_ENABLED !== "true") {
      console.log("[nudge-engine] Nudges disabled (NUDGE_ENABLED != true). Skipping.")
      return
    }

    const now = new Date()
    console.log(`[nudge-engine] Run started at ${now.toISOString()}`)

    const serviceClient = createServerClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        realtime: { transport: ws as unknown as typeof WebSocket },
      },
    )

    // Fetch productive windows and push subscriptions in parallel.
    const [windowsResult, subsResult] = await Promise.all([
      serviceClient
        .from("productive_windows")
        .select("user_id, hour_of_day, day_of_week, score, updated_at")
        .gt("score", 0),
      serviceClient
        .from("push_subscriptions")
        .select("user_id, endpoint, p256dh, auth"),
    ])

    const allWindows = windowsResult.data ?? []
    const allSubs = subsResult.data ?? []
    const subsByUser = new Map<string, typeof allSubs>()
    for (const s of allSubs) {
      const existing = subsByUser.get(s.user_id) ?? []
      existing.push(s)
      subsByUser.set(s.user_id, existing)
    }

    console.log(`[nudge-engine] productive_windows rows: ${allWindows.length}, push_subscriptions rows: ${allSubs.length}`)
    if (windowsResult.error) console.error("[nudge-engine] productive_windows query error:", windowsResult.error)
    if (subsResult.error) console.error("[nudge-engine] push_subscriptions query error:", subsResult.error)

    // ── Section A: Productive Window Nudges ───────────────────────────────────
    // Fire only during the user's local productive day+hour, at most once per 20h.

    const uniqueUserIds = [...new Set(allWindows.map((w) => w.user_id))]
    const allSubUserIds = allSubs.map((s) => s.user_id)
    const profileUserIds = [...new Set([...uniqueUserIds, ...allSubUserIds])]

    const { data: userProfiles } = await serviceClient
      .from("profiles")
      .select("id, timezone, quiet_hours_start, quiet_hours_end, nudge_frequency, nudge_paused_until")
      .in("id", profileUserIds)

    const profileByUser = new Map(
      (userProfiles ?? []).map((p) => [p.id, p]),
    )
    const tzByUser = new Map(
      (userProfiles ?? []).map((p) => {
        const coerced = coerceTimezone(p.timezone)
        if (p.timezone && coerced !== p.timezone) {
          console.warn(`[nudge-engine] uid=${p.id} has invalid timezone "${p.timezone}" — using ${coerced}`)
        }
        return [p.id, coerced]
      }),
    )

    // Key: "${day_of_week}:${hour_of_day}" — must match both day AND hour, not just hour.
    const windowsByUser = new Map<string, Set<string>>()
    for (const w of allWindows) {
      // Scores are all-time cumulative; slots whose score decayed to ~0 are
      // stale habits and must stop triggering nudges (matches Insights page).
      if (!isActiveSlot(w.score, w.updated_at, now)) continue
      if (!windowsByUser.has(w.user_id)) windowsByUser.set(w.user_id, new Set())
      windowsByUser.get(w.user_id)!.add(`${w.day_of_week}:${w.hour_of_day}`)
    }

    const productiveUserIds = uniqueUserIds.filter((uid) => {
      const tz = tzByUser.get(uid) ?? getDefaultTimezone()
      const localHour = getLocalHour(now, tz)
      const localDay = getLocalDay(now, tz)
      const key = `${localDay}:${localHour}`
      const matches = windowsByUser.get(uid)?.has(key) ?? false
      console.log(`[nudge-engine] Section A uid=${uid} tz=${tz} day=${localDay} hour=${localHour} key=${key} matches=${matches}`)
      return matches
    })

    // Extended to 14 days so assignments due next week are always found.
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

    console.log(`[nudge-engine] Section A: ${productiveUserIds.length} user(s) in productive window`)
    let productiveWindowSent = 0

    const sectionAResults = await Promise.allSettled(
      productiveUserIds.map(async (userId) => {
        const subs = subsByUser.get(userId) ?? []
        if (subs.length === 0) {
          console.log(`[nudge-engine] Section A uid=${userId} no push subscription — skipping`)
          return
        }

        const pf = profileByUser.get(userId)
        if (!pf) {
          console.log(`[nudge-engine] Section A uid=${userId} no profile — skipping`)
          return
        }

        // Quiet hours check
        const localHour = getLocalHour(now, tzByUser.get(userId) ?? getDefaultTimezone())

        if (isInQuietHours(pf.quiet_hours_start, pf.quiet_hours_end, localHour)) {
          console.log(`[nudge-engine] Section A uid=${userId} in quiet hours — skipping`)
          return
        }

        // Nudge pause check
        if (pf.nudge_paused_until && new Date(pf.nudge_paused_until) > now) {
          console.log(`[nudge-engine] Section A uid=${userId} nudges paused until ${pf.nudge_paused_until} — skipping`)
          return
        }

        // Frequency check - minimal skips productive window nudges entirely
        if (pf.nudge_frequency === "minimal") {
          console.log(`[nudge-engine] Section A uid=${userId} frequency=minimal — skipping`)
          return
        }

        // Dedup window: 4h for aggressive, 20h for normal
        const dedupWindowMs = pf.nudge_frequency === "aggressive" ? 4 * 60 * 60 * 1000 : 20 * 60 * 60 * 1000
        const dedupSince = new Date(now.getTime() - dedupWindowMs)

        const { data: recentLogs } = await serviceClient
          .from("nudge_logs")
          .select("id")
          .eq("user_id", userId)
          .eq("nudge_type", "productive_window")
          .gte("sent_at", dedupSince.toISOString())
          .order("sent_at", { ascending: false })
          .limit(1)

        if (recentLogs && recentLogs.length > 0) {
          console.log(`[nudge-engine] Section A uid=${userId} dedup hit — nudge already sent in last ${dedupWindowMs / 3_600_000}h`)
          return
        }

        // Fetch up to 5 upcoming incomplete assignments due within 14 days for workload context.
        const { data: assignments, error: assignmentsError } = await serviceClient
          .from("assignments")
          .select("id, title, due_at, courses(name)")
          .eq("user_id", userId)
          .eq("is_completed", false)
          .is("dismissed_at", null)
          .gt("due_at", now.toISOString())
          .lt("due_at", fourteenDaysFromNow.toISOString())
          .order("due_at", { ascending: true })
          .limit(5)

        if (assignmentsError) {
          console.error(`[nudge-engine] Section A uid=${userId} assignments query error:`, assignmentsError)
          return
        }
        console.log(`[nudge-engine] Section A uid=${userId} upcoming assignments (14d window): ${assignments?.length ?? 0}`)
        if (!assignments || assignments.length === 0) return

        const userTz = tzByUser.get(userId) ?? getDefaultTimezone()
        const upcomingList = assignments.map((a) => ({
          title: a.title,
          courseName: (a.courses as { name: string } | null)?.name,
          dueAt: a.due_at,
        }))

        console.log(`[nudge-engine] Section A uid=${userId} calling generateProductiveWindowNudge (${upcomingList.length} tasks)`)
        const nudgeText = await generateProductiveWindowNudge({
          upcomingAssignments: upcomingList,
          totalPendingCount: assignments.length,
          userTz,
        })
        console.log(`[nudge-engine] Section A uid=${userId} nudge text: "${nudgeText}"`)

        // Claim before send: upsert refreshes sent_at (the 20h/4h dedup window
        // reads it). A plain insert would silently fail on the unique index the
        // second time the same assignment is "nearest" → repeat-window spam.
        const nearest = assignments[0]
        const claimRow = {
          user_id: userId,
          assignment_id: nearest?.id ?? null,
          nudge_type: "productive_window",
          sent_at: now.toISOString(),
        }
        const { error: claimError } = nearest
          ? await serviceClient.from("nudge_logs").upsert(claimRow, { onConflict: "user_id,assignment_id,nudge_type" })
          : await serviceClient.from("nudge_logs").insert(claimRow) // NULL assignment_id: no conflict possible
        if (claimError) {
          console.error(`[nudge-engine] Section A uid=${userId} claim failed — NOT sending:`, claimError.message)
          return
        }

        // Send to ALL devices for this user.
        let delivered = false
        for (const sub of subs) {
          const subscription: webpush.PushSubscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          }
          try {
            await sendPushNotification(subscription, nudgeText, "Peak Focus Window ⚡")
            delivered = true
            console.log(`[nudge-engine] Section A uid=${userId} push sent to ${sub.endpoint.slice(0, 50)}… ✓`)
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number })?.statusCode
            if (statusCode === 410 || statusCode === 404) {
              // Subscription expired — clean up
              console.log(`[nudge-engine] Section A uid=${userId} stale sub (${statusCode}), deleting`)
              await serviceClient.from("push_subscriptions").delete().eq("endpoint", sub.endpoint)
            } else {
              console.error(`[nudge-engine] Section A uid=${userId} push failed:`, err)
            }
          }
        }

        if (delivered) {
          productiveWindowSent++
          await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: "productive_window" })
        } else {
          // Nothing went out — release the claim so the next run retries.
          await serviceClient.from("nudge_logs").delete()
            .eq("user_id", userId)
            .eq("nudge_type", "productive_window")
            .eq("sent_at", now.toISOString())
          console.log(`[nudge-engine] Section A uid=${userId} released claim (0 devices delivered)`)
        }
      }),
    )

    for (let i = 0; i < sectionAResults.length; i++) {
      const r = sectionAResults[i]
      if (r.status === "rejected") {
        console.error(`[nudge-engine] Section A uid=${productiveUserIds[i]} threw:`, r.reason)
      }
    }
    console.log(`[nudge-engine] Section A done: productive_window_sent=${productiveWindowSent}`)

    // ── Section B: Deadline Nudges ────────────────────────────────────────────
    // Catch-up buckets over remaining time: 1h (≤90m), 6h (≤7h), 12h (≤13h).
    // Each assignment gets exactly the bucket containing its remaining time,
    // once. Wording is computed from the actual remaining time, not a static
    // label, so "Due in ~5 Hours" means 5 hours — not "somewhere in 5–7h".

    const thirteenHoursFromNow = new Date(now.getTime() + 13 * 3_600_000)
    let deadlineSent = 0

    console.log(`[nudge-engine] Section B: processing ${subsByUser.size} user(s)`)
    const sectionBResults = await Promise.allSettled(
      [...subsByUser.entries()].map(async ([userId, subs]) => {
        const pf = profileByUser.get(userId)
        const userTz = tzByUser.get(userId) ?? getDefaultTimezone()

        // Quiet hours check (skip if profile is missing)
        if (pf) {
          const localHour = getLocalHour(now, userTz)

          if (isInQuietHours(pf.quiet_hours_start, pf.quiet_hours_end, localHour)) {
            console.log(`[nudge-engine] Section B uid=${userId} in quiet hours — skipping`)
            return
          }

          if (pf.nudge_paused_until && new Date(pf.nudge_paused_until) > now) {
            console.log(`[nudge-engine] Section B uid=${userId} nudges paused until ${pf.nudge_paused_until} — skipping`)
            return
          }
        } else {
          console.log(`[nudge-engine] Section B uid=${userId} no profile — allowing nudges (default behavior)`)
        }

        // Fetch all incomplete assignments due within the widest threshold window.
        const { data: upcomingAssignments } = await serviceClient
          .from("assignments")
          .select("id, title, due_at")
          .eq("user_id", userId)
          .eq("is_completed", false)
          .is("dismissed_at", null)
          .gt("due_at", now.toISOString())
          .lte("due_at", thirteenHoursFromNow.toISOString())
          .order("due_at", { ascending: true })

        console.log(`[nudge-engine] Section B uid=${userId} assignments in 13h window: ${upcomingAssignments?.length ?? 0}`)
        if (!upcomingAssignments || upcomingAssignments.length === 0) return

        // Fetch already-sent deadline logs for this user's upcoming assignments.
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

        // Group assignments by their current (not-yet-sent) bucket.
        const byBucket = new Map<DeadlineThreshold, typeof upcomingAssignments>()
        for (const a of upcomingAssignments) {
          if (!a.due_at) continue
          const threshold = pickDeadlineThreshold(
            new Date(a.due_at).getTime() - now.getTime(),
            sentByAssignment.get(a.id) ?? new Set<DeadlineType>(),
          )
          if (!threshold) continue
          const list = byBucket.get(threshold) ?? []
          list.push(a)
          byBucket.set(threshold, list)
        }

        for (const [threshold, list] of byBucket) {
          // In minimal mode, only send 1h deadline nudges.
          if (pf?.nudge_frequency === "minimal" && threshold.type !== "1h") continue

          const earliest = list[0] // query is ordered by due_at asc; bucket filter preserves order
          const remainingMs = new Date(earliest.due_at!).getTime() - now.getTime()
          const remaining = formatRemaining(remainingMs)
          const clockLabel = list.length === 1
            ? `(by ${formatClockTime(new Date(earliest.due_at!), userTz)})`
            : undefined
          const message = buildDeadlineMessage(
            list.map((a) => ({ title: a.title, dueAt: a.due_at })),
            remaining,
            clockLabel,
          )
          const notifTitle = `Due in ${remaining} ${threshold.icon}`

          // Claim the bucket FIRST — never send without a durable dedup record.
          // (An insert failure previously meant repeated sends every run.)
          const { error: claimError } = await serviceClient.from("nudge_logs").upsert(
            list.map((a) => ({
              user_id: userId,
              assignment_id: a.id,
              nudge_type: threshold.type,
              sent_at: now.toISOString(),
            })),
            { onConflict: "user_id,assignment_id,nudge_type", ignoreDuplicates: true },
          )
          if (claimError) {
            console.error(`[nudge-engine] Section B uid=${userId} ${threshold.type} claim failed — NOT sending:`, claimError.message)
            continue
          }

          console.log(`[nudge-engine] Section B uid=${userId} sending ${threshold.type} deadline nudge for ${list.length} assignment(s): "${message}"`)
          let delivered = false
          for (const sub of subs) {
            const subscription: webpush.PushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            }
            try {
              // Expire with the deadline itself — a "due in 1h" nudge held by
              // the push service must not ping the student 20 hours late.
              await sendPushNotification(subscription, message, notifTitle, Math.max(60, Math.floor(remainingMs / 1000)))
              delivered = true
              console.log(`[nudge-engine] Section B uid=${userId} ${threshold.type} push sent successfully ✓`)
            } catch (err: unknown) {
              const statusCode = (err as { statusCode?: number })?.statusCode
              if (statusCode === 410 || statusCode === 404) {
                console.log(`[nudge-engine] Section B uid=${userId} stale sub (${statusCode}), deleting`)
                await serviceClient.from("push_subscriptions").delete().eq("endpoint", sub.endpoint)
              } else {
                console.error(`[nudge-engine] Section B uid=${userId} push failed:`, err)
              }
            }
          }

          if (delivered) {
            deadlineSent++
            await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: threshold.type })
          } else {
            // Nothing went out — release the claim so the next run retries.
            await serviceClient
              .from("nudge_logs")
              .delete()
              .eq("user_id", userId)
              .in("assignment_id", list.map((a) => a.id))
              .eq("nudge_type", threshold.type)
            console.log(`[nudge-engine] Section B uid=${userId} released ${threshold.type} claim (0 devices delivered)`)
          }
        }
      }),
    )

    for (let i = 0; i < sectionBResults.length; i++) {
      const r = sectionBResults[i]
      if (r.status === "rejected") {
        console.error(`[nudge-engine] Section B user[${i}] threw:`, r.reason)
      }
    }
    console.log(`[nudge-engine] Section B done: deadline_sent=${deadlineSent}`)

    // ── Section C: Cleanup completed assignments ──────────────────────────────
    // Hard-delete assignments marked completed more than COMPLETED_RETENTION_DAYS
    // (14) ago — MUST match the "recently completed" window on the dashboard
    // pages, or Completed tabs and Insights completion stats silently decay.
    // nudge_logs cascade-deletes via FK, so no orphan cleanup needed.
    const retentionCutoff = new Date(now.getTime() - COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    let cleanedUp = 0
    try {
      const { count } = await serviceClient
        .from("assignments")
        .delete({ count: "exact" })
        .eq("is_completed", true)
        .lt("updated_at", retentionCutoff.toISOString())
      cleanedUp = count ?? 0
      console.log(`[nudge-engine] Section C: deleted ${cleanedUp} completed assignment(s) older than ${COMPLETED_RETENTION_DAYS} days`)
    } catch (err) {
      console.error("[nudge-engine] Section C cleanup error:", err)
    }

    // ── Section D: Overdue reminders ──────────────────────────────────────────
    // One nudge per 24h for the first 72h after the deadline, stopping earlier
    // if completed or dismissed. Quiet hours and pause are honored.
    // CLAIM BEFORE SEND: the nudge_logs row is upserted first; if the claim
    // fails we do NOT send. (Prod bug fixed 2026-08-23: sends succeeded while
    // every log insert failed → overdue spam every run.)
    let overdueSent = 0
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    console.log(`[nudge-engine] Section D: processing ${subsByUser.size} user(s) for overdue`)
    const sectionDResults = await Promise.allSettled(
      [...subsByUser.entries()].map(async ([userId, subs]) => {
        const pf = profileByUser.get(userId)
        const userTz = tzByUser.get(userId) ?? getDefaultTimezone()

        if (pf) {
          const localHour = getLocalHour(now, userTz)
          if (isInQuietHours(pf.quiet_hours_start, pf.quiet_hours_end, localHour)) {
            console.log(`[nudge-engine] Section D uid=${userId} in quiet hours — skipping`)
            return
          }
          if (pf.nudge_paused_until && new Date(pf.nudge_paused_until) > now) {
            console.log(`[nudge-engine] Section D uid=${userId} nudges paused — skipping`)
            return
          }
        }

        // Past-due, incomplete, non-dismissed assignments for this user.
        // Fetch up to 25 (not just 5): with >5 overdue, the oldest 5 once
        // fit and then got deduped — items 6+ could NEVER be nudged. Dedup
        // happens AFTER the fetch, then we cap sends at 5.
        const { data: overdueAssignments, error: overdueError } = await serviceClient
          .from("assignments")
          .select("id, title, due_at, courses(name)")
          .eq("user_id", userId)
          .eq("is_completed", false)
          .is("dismissed_at", null)
          .lt("due_at", now.toISOString())
          .gt("due_at", new Date(now.getTime() - OVERDUE_REMINDER_WINDOW_MS).toISOString())
          .order("due_at", { ascending: true })
          .limit(25)

        if (overdueError) {
          console.error(`[nudge-engine] Section D uid=${userId} overdue query error:`, overdueError)
          return
        }
        if (!overdueAssignments || overdueAssignments.length === 0) return

        // 24-hour daily dedup: skip any assignment nudged within the last 24 hours.
        const assignmentIds = overdueAssignments.map((a) => a.id)
        const { data: existingOverdueLogs, error: overdueLogsError } = await serviceClient
          .from("nudge_logs")
          .select("assignment_id, sent_at")
          .eq("user_id", userId)
          .eq("nudge_type", "overdue")
          .in("assignment_id", assignmentIds)
          .gte("sent_at", twentyFourHoursAgo.toISOString())

        if (overdueLogsError) {
          console.error(`[nudge-engine] Section D uid=${userId} history unavailable — NOT sending`, overdueLogsError.message)
          return
        }

        // Cap pushes per run AFTER the 24h dedup so the overdue queue rotates.
        const toNudge = filterDailyOverdueNudge(overdueAssignments, existingOverdueLogs ?? [], now).slice(0, 5)
        if (toNudge.length === 0) {
          console.log(`[nudge-engine] Section D uid=${userId} all overdue already nudged within last 24h — skipping`)
          return
        }

        for (const a of toNudge) {
          const ttl = overdueReminderTtl(a.due_at, new Date())
          if (ttl === 0) continue
          const title = a.title.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 90)
          const nudgeText = `${title} is overdue. Already done? Mark it complete in DuePulse, or dismiss it if you no longer need it. Reminders stop after 3 days.`

          // Claim today's slot first — see claim-before-send note above.
          const { error: claimError } = await serviceClient
            .from("nudge_logs")
            .upsert(
              { user_id: userId, assignment_id: a.id, nudge_type: "overdue", sent_at: now.toISOString() },
              { onConflict: "user_id,assignment_id,nudge_type" },
            )
          if (claimError) {
            console.error(`[nudge-engine] Section D uid=${userId} claim failed for "${a.title}" — NOT sending:`, claimError.message)
            continue
          }

          console.log(`[nudge-engine] Section D uid=${userId} overdue nudge for "${a.title}"`)
          let delivered = false
          for (const sub of subs) {
            const subscription: webpush.PushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            }
            try {
              const remainingTtl = overdueReminderTtl(a.due_at, new Date())
              if (remainingTtl === 0) break
              await sendPushNotification(subscription, nudgeText, "Overdue assignment", remainingTtl)
              delivered = true
            } catch (err: unknown) {
              const statusCode = (err as { statusCode?: number })?.statusCode
              if (statusCode === 410 || statusCode === 404) {
                console.log(`[nudge-engine] Section D uid=${userId} stale sub (${statusCode}), deleting`)
                await serviceClient.from("push_subscriptions").delete().eq("endpoint", sub.endpoint)
              } else {
                console.error(`[nudge-engine] Section D uid=${userId} push failed:`, err)
              }
            }
          }

          if (delivered) {
            overdueSent++
            await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: "overdue" })
          } else {
            // Nothing went out — release the claim so the next run retries.
            await serviceClient
              .from("nudge_logs")
              .delete()
              .eq("user_id", userId)
              .eq("assignment_id", a.id)
              .eq("nudge_type", "overdue")
            console.log(`[nudge-engine] Section D uid=${userId} released claim for "${a.title}" (0 devices delivered)`)
          }
        }
      }),
    )

    for (let i = 0; i < sectionDResults.length; i++) {
      const r = sectionDResults[i]
      if (r.status === "rejected") {
        console.error(`[nudge-engine] Section D user[${i}] threw:`, r.reason)
      }
    }
    console.log(`[nudge-engine] Section D done: overdue_sent=${overdueSent}`)

    return {
      productive_window_sent: productiveWindowSent,
      deadline_sent: deadlineSent,
      cleaned_up: cleanedUp,
      overdue_sent: overdueSent,
    }
  },
})
