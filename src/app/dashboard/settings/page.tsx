import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsForm from "@/components/SettingsForm";
import TestNotifButton from "@/components/TestNotifButton";
import PushNotificationButton from "@/components/PushNotificationButton";
import { saveNotificationSettings, pauseNotificationsAction } from "@/app/actions";
import { FALLBACK_TIMEZONE } from "@/lib/time";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

export const metadata = { title: "Settings — DuePulse" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("canvas_token, canvas_domain, quiet_hours_start, quiet_hours_end, nudge_frequency, stress_threshold, nudge_paused_until, timezone")
    .eq("id", user.id)
    .single();

  return (
    <>
      <header className="border-b border-border bg-background sticky top-0 z-30 h-[57px]">
        <div className="pl-14 lg:pl-0 px-5 h-full flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <h1 className="text-foreground font-semibold text-base">Settings</h1>
        </div>
      </header>

      <main className="flex-1 px-5 py-6 sm:px-6 sm:py-7 max-w-2xl w-full mx-auto">
        <div className="flex flex-col gap-5">
          {/* Canvas Connection */}
          <section className="rounded-sm bg-card border border-border p-5 sm:p-6">
            <h2 className="text-foreground font-semibold text-base mb-4">Canvas Connection</h2>
            {profile?.canvas_token && profile?.canvas_domain ? (
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-foreground text-sm font-medium">Connected to {profile.canvas_domain}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Token saved · reconnect to update</p>
                </div>
                <Link href="/onboarding" className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover transition-colors">
                  Reconnect <ExternalLink size={12} />
                </Link>
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-muted-foreground text-sm">Canvas not connected</p>
                <Link href="/onboarding" className="rounded-sm bg-primary hover:bg-primary-hover text-white text-sm font-semibold px-4 py-2 transition-colors shadow-none">
                  Connect Canvas
                </Link>
              </div>
            )}
          </section>

          {/* Push Notifications */}
          <section className="rounded-sm bg-card border border-border p-5 sm:p-6">
            <h2 className="text-foreground font-semibold text-base mb-4">Push Notifications</h2>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <PushNotificationButton userId={user.id} />
              <TestNotifButton />
            </div>
          </section>

          {/* Notification settings form */}
          <SettingsForm
            saveSettings={saveNotificationSettings}
            pauseNotifications={pauseNotificationsAction}
            initialQuietStart={profile?.quiet_hours_start ?? null}
            initialQuietEnd={profile?.quiet_hours_end ?? null}
            initialFrequency={profile?.nudge_frequency ?? "normal"}
            initialThreshold={profile?.stress_threshold ?? 5}
            initialPausedUntil={profile?.nudge_paused_until ?? null}
            initialTimezone={profile?.timezone ?? FALLBACK_TIMEZONE}
          />

          {/* Account */}
          <section className="rounded-sm bg-card border border-border p-5 sm:p-6">
            <h2 className="text-foreground font-semibold text-base mb-4">Account</h2>
            <div>
              <p className="text-body text-sm font-medium">Email</p>
              <p className="text-muted-foreground text-sm">{user.email}</p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
