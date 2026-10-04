import { readAllPages } from "@/lib/read-all-pages"
import { canNotify } from "@/lib/notification-preferences"
import { queue, schedules } from "@trigger.dev/sdk/v3"
import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { env } from "@/lib/env"
import { syncUserCanvas } from "@/lib/canvas-sync"
import { sendPushNotification } from "@/lib/webpush"
import type { Database } from "@/database.types"
import type webpush from "web-push"
import ws from "ws"

// Server-side Canvas sync: keeps assignments fresh (and nudges firing) for
// users who never open the app. AutoSync.tsx only runs in an open browser
// tab, so without this task a due-date change while the app is closed never
// reaches the DB and the nudge engine has nothing to nudge about.
export const canvasSync = schedules.task({
  id: "canvas-sync",
  queue: queue({ name: "canvas-sync", concurrencyLimit: 1 }),
  cron: "5,35 * * * *", // every 30 min (UTC), offset from the nudge engine's */15 runs
  run: async () => {
    // The ws transport is required even though this task never subscribes to
    // channels: on the Trigger.dev runtime (Node 21, no native WebSocket) the
    // SupabaseClient constructor initializes its realtime client eagerly and
    // throws without it. Same pattern as nudge-engine.ts.
    const serviceClient = createServerClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        realtime: { transport: ws as unknown as typeof WebSocket },
      },
    )

    const profiles = await readAllPages((from, to) => serviceClient
      .from("profiles").select("id")
      .not("canvas_token", "is", null).not("canvas_domain", "is", null)
      .order("id").range(from, to))

    const userIds = (profiles ?? []).map((p) => p.id)
    console.log(`[canvas-sync] syncing ${userIds.length} user(s)`)

    let ok = 0
    let expired = 0
    let failed = 0

    // Small chunks: bounded Canvas API concurrency, no thundering herd.
    for (let i = 0; i < userIds.length; i += 5) {
      const chunk = userIds.slice(i, i + 5)
      const results = await Promise.allSettled(
        chunk.map(async (userId) => {
          const r = await syncUserCanvas(serviceClient, userId)
          if (r.ok) {
            ok++
            return
          }
          if (r.reason === "token_expired" || r.reason === "decrypt_failed") {
            expired++
            await notifyTokenExpired(serviceClient, userId)
            return
          }
          failed++
          console.error(`[canvas-sync] uid=${userId} ${r.reason}: ${r.message}`)
        }),
      )
      results.forEach((r, j) => {
        if (r.status === "rejected") {
          failed++
          console.error(`[canvas-sync] uid=${chunk[j]} threw:`, r.reason)
        }
      })
    }

    console.log(`[canvas-sync] done: users=${userIds.length} ok=${ok} expired=${expired} failed=${failed}`)
    return { users: userIds.length, ok, expired, failed }
  },
})

// A dead Canvas token silently stops ALL nudges until the user happens to
// open the app. One push per 72h tells them to reconnect; claim-before-send
// via nudge_logs, same pattern as the nudge engine.
const TOKEN_EXPIRED_RENOTIFY_MS = 72 * 60 * 60 * 1000

export async function notifyTokenExpired(
  serviceClient: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  if (env.NUDGE_ENABLED !== "true") return
  const { data: profile } = await serviceClient.from("profiles")
    .select("timezone, quiet_hours_start, quiet_hours_end, nudge_paused_until")
    .eq("id", userId).single().throwOnError()
  if (!canNotify(profile, new Date())) return
  const since = new Date(Date.now() - TOKEN_EXPIRED_RENOTIFY_MS).toISOString()
  const { data: recent } = await serviceClient
    .from("nudge_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("nudge_type", "token_expired")
    .gte("sent_at", since)
    .limit(1)
    .throwOnError()

  if (recent && recent.length > 0) return // already notified within 72h

  const { data: subs } = await serviceClient
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)

  if (!subs || subs.length === 0) return

  // Claim before send. assignment_id is NULL so no conflict is possible;
  // a claim failure (e.g. CHECK not yet migrated) means do NOT send.
  const sentAt = new Date().toISOString()
  const { error: claimError } = await serviceClient.from("nudge_logs").insert({
    user_id: userId,
    assignment_id: null,
    nudge_type: "token_expired",
    sent_at: sentAt,
  })
  if (claimError) {
    console.error(`[canvas-sync] uid=${userId} token_expired claim failed — NOT sending:`, claimError.message)
    return
  }

  let delivered = false
  for (const sub of subs) {
    const subscription: webpush.PushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    }
    try {
      await sendPushNotification(
        subscription,
        "CourseCue can't reach Canvas. Open the app to reconnect your Canvas token.",
        "Canvas Disconnected ⚠️",
      )
      delivered = true
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode
      if (statusCode === 410 || statusCode === 404) {
        console.log(`[canvas-sync] uid=${userId} stale sub (${statusCode}), deleting`)
        await serviceClient.from("push_subscriptions").delete().eq("endpoint", sub.endpoint)
      } else {
        console.error(`[canvas-sync] uid=${userId} token_expired push failed:`, err)
      }
    }
  }

  if (!delivered) {
    // Nothing went out — release the claim so the next run retries.
    await serviceClient
      .from("nudge_logs")
      .delete()
      .eq("user_id", userId)
      .eq("nudge_type", "token_expired")
      .eq("sent_at", sentAt)
    console.log(`[canvas-sync] uid=${userId} released token_expired claim (0 devices delivered)`)
  } else {
    await serviceClient.from("nudge_events").insert({ user_id: userId, nudge_type: "token_expired" })
  }
}
