import { readAllPages } from "@/lib/read-all-pages"
import { canNotify } from "@/lib/notification-preferences"
import { queue, schedules } from "@trigger.dev/sdk"
import { createServerClient } from "@supabase/ssr"
import { env } from "@/lib/env"
import { generateProductiveWindowNudge } from "@/lib/nim"
import { sendPushNotification } from "@/lib/webpush"
import { getLocalHour, getLocalDay, getDefaultTimezone, formatClockTime, coerceTimezone } from "@/lib/time"
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
    const [allWindows, allSubs, userProfiles] = await Promise.all([
      readAllPages((from, to) => serviceClient.from("productive_windows")
        .select("user_id, hour_of_day, day_of_week, score, updated_at").gt("score", 0)
        .order("user_id").order("day_of_week").order("hour_of_day").range(from, to)),
      readAllPages((from, to) => serviceClient.from("push_subscriptions")
        .select("user_id, endpoint, p256dh, auth").order("id").range(from, to)),
      readAllPages((from, to) => serviceClient.from("profiles")
        .select("id, timezone, quiet_hours_start, quiet_hours_end, nudge_frequency, nudge_paused_until")
        .order("id").range(from, to)),
    ])
    const subsByUser = new Map<string, typeof allSubs>()
    for (const s of allSubs) {
      const existing = subsByUser.get(s.user_id) ?? []
      existing.push(s)
      subsByUser.set(s.user_id, existing)
    }

    console.log(`[nudge-engine] productive_windows rows: ${allWindows.length}, push_subscriptions rows: ${allSubs.length}`)

    // ── Section A: Productive Window Nudges ───────────────────────────────────
    // Fire only during the user's local productive day+hour, at most once per 20h.

    const uniqueUserIds = [...new Set(allWindows.map((w) => w.user_id))]
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

        if (!canNotify(pf, new Date())) return

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
          .throwOnError()

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
            if (!canNotify(pf, new Date())) break
            await sendPushNotification(subscription, nudgeText, "Peak Focus Window ⚡", 60 * 60)
            delivered = true
            console.log(`[nudge-engine] Section A uid=${userId} push accepted by service`)
          } catch (err: unknown) {
            const statusCode = (err as { statusCode?: number })?.statusCode
            if (statusCode === 410 || statusCode === 404) {
              // Subscription expired — clean up
              console.log(`[nudge-engine] Section A uid=${userId} stale sub (${statusCode}), deleting`)
              await serviceClient.from("push_subscriptions").delete().eq("user_id", userId)
                .eq("endpoint", sub.endpoint).eq("p256dh", sub.p256dh).eq("auth", sub.auth)
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
        if (!canNotify(pf, new Date())) return

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
          .throwOnError()

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

          // Claim the bucket FIRST — never send without a durable dedup record.
          // (An insert failure previously meant repeated sends every run.)
          const { data: claimed, error: claimError } = await serviceClient.from("nudge_logs").upsert(
            list.map((a) => ({
              user_id: userId,
              assignment_id: a.id,
              nudge_type: threshold.type,
              sent_at: now.toISOString(),
            })),
            { onConflict: "user_id,assignment_id,nudge_type", ignoreDuplicates: true },
          ).select("assignment_id")
          if (claimError) {
            console.error(`[nudge-engine] Section B uid=${userId} ${threshold.type} claim failed — NOT sending:`, claimError.message)
            continue
          }

          const claimedIds = new Set((claimed ?? []).map(row => row.assignment_id))
          const claimedList = list.filter(row => claimedIds.has(row.id))
          if (!claimedList.length) continue
          const earliest = claimedList[0] // query is ordered by due_at asc; bucket filter preserves order
          const remainingMs = new Date(earliest.due_at!).getTime() - Date.now()
          if (remainingMs <= 0 || !canNotify(pf, new Date())) {
            await serviceClient.from("nudge_logs").delete().eq("user_id", userId)
              .in("assignment_id", claimedList.map(a => a.id)).eq("nudge_type", threshold.type).eq("sent_at", now.toISOString())
            continue
          }
          const remaining = formatRemaining(remainingMs)
          const clockLabel = claimedList.length === 1
            ? `(by ${formatClockTime(new Date(earliest.due_at!), tzByUser.get(userId) ?? getDefaultTimezone())})`
            : undefined
          const message = buildDeadlineMessage(
            claimedList.map((a) => ({ title: a.title, dueAt: a.due_at })),
            remaining,
            clockLabel,
          )
          const notifTitle = `Due in ${remaining} ${threshold.icon}`

          console.log(`[nudge-engine] Section B uid=${userId} sending ${threshold.type} deadline nudge for ${claimedList.length} assignment(s)`)
          let delivered = false
          for (const sub of subs) {
            const subscription: webpush.PushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            }
            try {
              // Expire with the deadline itself — a "due in 1h" nudge held by
              // the push service must not ping the student 20 hours late.
              const ttl = Math.floor((new Date(earliest.due_at!).getTime() - Date.now()) / 1000)
              if (ttl <= 0 || !canNotify(pf, new Date())) break
              await sendPushNotification(subscription, message, notifTitle, ttl, claimedList.length === 1 ? earliest.id : undefined)
              delivered = true
              console.log(`[nudge-engine] Section B uid=${userId} ${threshold.type} push sent successfully ✓`)
            } catch (err: unknown) {
              const statusCode = (err as { statusCode?: number })?.statusCode
              if (statusCode === 410 || statusCode === 404) {
                console.log(`[nudge-engine] Section B uid=${userId} stale sub (${statusCode}), deleting`)
                await serviceClient.from("push_subscriptions").delete().eq("user_id", userId)
                  .eq("endpoint", sub.endpoint).eq("p256dh", sub.p256dh).eq("auth", sub.auth)
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
              .in("assignment_id", claimedList.map((a) => a.id))
              .eq("sent_at", now.toISOString())
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

    // Keep completion records: they preserve local decisions across Canvas sync.
    // Pages limit visible history without deleting these records or nudge logs.

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
        if (!canNotify(pf, new Date())) return

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
          const nudgeText = `${title} is overdue. Already done? Mark it complete in CourseCue, or dismiss it if you no longer need it. Reminders stop after 3 days.`

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

          console.log(`[nudge-engine] Section D uid=${userId} overdue nudge claimed`)
          let delivered = false
          for (const sub of subs) {
            const subscription: webpush.PushSubscription = {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            }
            try {
              const remainingTtl = overdueReminderTtl(a.due_at, new Date())
              if (remainingTtl === 0 || !canNotify(pf, new Date())) break
              await sendPushNotification(subscription, nudgeText, "Overdue assignment", remainingTtl, a.id)
              delivered = true
            } catch (err: unknown) {
              const statusCode = (err as { statusCode?: number })?.statusCode
              if (statusCode === 410 || statusCode === 404) {
                console.log(`[nudge-engine] Section D uid=${userId} stale sub (${statusCode}), deleting`)
                await serviceClient.from("push_subscriptions").delete().eq("user_id", userId)
                  .eq("endpoint", sub.endpoint).eq("p256dh", sub.p256dh).eq("auth", sub.auth)
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
            console.log(`[nudge-engine] Section D uid=${userId} released overdue claim (0 devices delivered)`)
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
      overdue_sent: overdueSent,
    }
  },
})
