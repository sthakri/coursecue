"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { FALLBACK_TIMEZONE } from "@/lib/time";

type SettingsFormProps = {
  saveSettings: (formData: FormData) => Promise<{ success?: boolean; error?: string }>;
  pauseNotifications: (formData: FormData) => Promise<{ success?: boolean; error?: string; pausedUntil?: string | null }>;
  initialQuietStart: number | null;
  initialQuietEnd: number | null;
  initialFrequency: string;
  initialThreshold: number;
  initialPausedUntil: string | null;
  initialTimezone?: string;
};

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC",
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12} ${period}`;
}

const FREQUENCIES = [
  { value: "aggressive", label: "Aggressive", desc: "During active windows, at most once every 4 hours" },
  { value: "normal", label: "Normal", desc: "During active windows, at most once every 20 hours" },
  { value: "minimal", label: "Minimal", desc: "Final deadline reminder (about 1 hour) and overdue follow-ups for up to 3 days" },
] as const;

const PAUSE_DURATIONS = [
  { hours: 1, label: "1h" },
  { hours: 4, label: "4h" },
  { hours: 24, label: "24h" },
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-card border border-border p-5 sm:p-6 shadow-sm">
      <h2 className="text-foreground font-semibold text-lg mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" disabled={disabled} role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-9 h-5 bg-input rounded-full peer peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-3 peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
    </label>
  );
}

export default function SettingsForm({
  saveSettings,
  pauseNotifications,
  initialQuietStart,
  initialQuietEnd,
  initialFrequency,
  initialThreshold,
  initialPausedUntil,
  initialTimezone = FALLBACK_TIMEZONE,
}: SettingsFormProps) {
  const [quietEnabled, setQuietEnabled] = useState(initialQuietStart !== null && initialQuietEnd !== null);
  const [quietStart, setQuietStart] = useState(initialQuietStart ?? 22);
  const [quietEnd, setQuietEnd] = useState(initialQuietEnd ?? 8);
  const [frequency, setFrequency] = useState(initialFrequency);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [isPending, startTransition] = useTransition();
  const [isPausing, startPauseTransition] = useTransition();
  // Pause state derives ONLY from `pausedUntil`, which the pause action
  // returns. Reading just the initial prop left the UI claiming "resumed"
  // (or showing no countdown) while the DB said otherwise.
  const [pausedUntil, setPausedUntil] = useState<string | null>(initialPausedUntil);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedRemaining, setPausedRemaining] = useState(0);
  const [pauseEnabled, setPauseEnabled] = useState(() => {
    if (!initialPausedUntil) return false;
    return new Date(initialPausedUntil).getTime() > Date.now();
  });
  const [activeDuration, setActiveDuration] = useState(1);

  useEffect(() => {
    function update() {
      if (!pausedUntil) { setIsPaused(false); setPausedRemaining(0); return; }
      const remaining = new Date(pausedUntil).getTime() - Date.now();
      if (remaining > 0) {
        setIsPaused(true);
        setPauseEnabled(true);
        setPausedRemaining(Math.max(0, Math.round(remaining / 60000)));
      } else {
        setIsPaused(false);
        setPausedRemaining(0);
        setPauseEnabled(false);
        setPausedUntil(null);
      }
    }
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [pausedUntil]);

  function handleSave(formData: FormData) {
    // Equal start/end is "off" in the nudge engine — saving it as enabled
    // would show quiet hours while nothing is quiet. Reject instead.
    if (quietEnabled && quietStart === quietEnd) {
      toast.error("Quiet hours start and end can't be the same");
      return;
    }
    formData.set("quiet_hours_enabled", quietEnabled ? "on" : "off");
    formData.set("quiet_hours_start", String(quietStart));
    formData.set("quiet_hours_end", String(quietEnd));
    formData.set("nudge_frequency", frequency);
    formData.set("stress_threshold", String(threshold));
    formData.set("timezone", timezone);
    startTransition(async () => {
      try {
        const result = await saveSettings(formData);
        if (result.error) toast.error(result.error);
        else toast.success("Settings saved");
      } catch { toast.error("Could not save settings. Check your connection and try again."); }
    });
  }

  function handlePause(hours: number) {
    const fd = new FormData();
    fd.set("hours", String(hours));
    startPauseTransition(async () => {
      try {
      const result = await pauseNotifications(fd);
      if (result.error) {
        toast.error(result.error);
        setPauseEnabled(isPaused); // Restore the last saved state.
      } else {
        setPausedUntil(result.pausedUntil ?? null); // countdown derives from this
        if (hours === 0) toast.success("Notifications resumed");
        else toast.success(`Notifications paused for ${hours}h`);
      }
      } catch {
        setPauseEnabled(isPaused);
        toast.error("Could not change your pause. Check your connection and try again.");
      }
    });
  }

  function isInQuietZone(hour: number): boolean {
    if (!quietEnabled) return false;
    if (quietStart === quietEnd) return false; // equal start/end = off (matches nudge engine)
    if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
    return hour >= quietStart || hour < quietEnd;
  }

  const selectCls = "w-full rounded-sm bg-background border border-input text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="flex flex-col gap-5">
      <form className="space-y-5" onSubmit={(event) => {
        event.preventDefault();
        handleSave(new FormData(event.currentTarget));
      }}>
        {/* Quiet Hours */}
        <Section title="Quiet Hours">
          <div className="flex items-center justify-between mb-4">
            <p className="text-muted-foreground text-sm">Block notifications during these hours</p>
            <Toggle label="Enable quiet hours" checked={quietEnabled} onChange={setQuietEnabled} />
          </div>
          {quietEnabled && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="quiet-start" className="text-muted-foreground text-xs font-semibold uppercase tracking-widest block mb-1.5">Start</label>
                  <select id="quiet-start" value={quietStart} onChange={(e) => setQuietStart(Number(e.target.value))} className={selectCls}>
                    {HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="quiet-end" className="text-muted-foreground text-xs font-semibold uppercase tracking-widest block mb-1.5">End</label>
                  <select id="quiet-end" value={quietEnd} onChange={(e) => setQuietEnd(Number(e.target.value))} className={selectCls}>
                    {HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex h-7 rounded-sm overflow-hidden border border-border">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className={`flex-1 flex items-center justify-center text-[9px] font-medium transition-colors ${isInQuietZone(h) ? "bg-danger-soft text-danger" : "bg-primary-soft text-muted-foreground"}`} title={formatHour(h)}>
                    {h % 6 === 0 ? String(h) : ""}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-xs mt-2">Red = quiet — no notifications sent</p>
            </>
          )}
          {!quietEnabled && <p className="text-muted-foreground text-sm">Notifications can be sent at any hour</p>}
        </Section>

        {/* Nudge Frequency */}
        <Section title="Nudge Frequency">
          <div className="flex flex-col gap-3">
            {FREQUENCIES.map((opt) => (
              <label key={opt.value} className={`flex items-start gap-3 rounded-sm border p-4 cursor-pointer transition-colors focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-3 ${frequency === opt.value ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-surface-subtle"}`}>
                <input type="radio" name="nudge_frequency" aria-label={opt.label} value={opt.value} checked={frequency === opt.value} onChange={() => setFrequency(opt.value)} className="sr-only" />
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${frequency === opt.value ? "border-primary" : "border-input"}`}>
                  {frequency === opt.value && <span className="h-2 w-2 rounded-full bg-primary-hover" />}
                </span>
                <div>
                  <p className={`text-sm font-medium ${frequency === opt.value ? "text-primary" : "text-foreground"}`}>{opt.label}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </Section>

        {/* Stress Threshold */}
        <Section title="Workload Alert Threshold">
          <div className="flex items-center gap-4">
            <input
              type="number" aria-label="Workload alert threshold" min={1} max={20} value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
              className="w-16 rounded-sm bg-background border border-input text-foreground text-center text-lg font-semibold px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-muted-foreground text-sm">
              Show a stress alert when <span className="text-foreground font-semibold">{threshold}+</span> assignments are due in the next 14 days
            </p>
          </div>
        </Section>

        {/* Timezone */}
        <Section title="Timezone">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-muted-foreground text-sm">Used for deadline timing, quiet hours, and productive windows</p>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    if (detected) {
                      setTimezone(detected);
                      toast.success(`Timezone set to ${detected} — click Save Settings to apply`);
                    }
                  }
                }}
                className="text-xs text-primary hover:text-primary-hover font-medium transition-colors"
              >
                Auto-detect timezone
              </button>
            </div>
            <select
              aria-label="Timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={selectCls}
            >
              {!COMMON_TIMEZONES.includes(timezone) && (
                <option value={timezone}>{timezone} (Current)</option>
              )}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <div className="flex justify-end mt-5">
          <button type="submit" disabled={isPending} className="rounded-sm bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-6 py-2.5 transition-colors shadow-none">
            {isPending ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </form>

      {/* Pause Notifications */}
      <Section title="Pause Notifications">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-muted-foreground text-sm">Temporarily silence all nudges</p>
          <div className="flex items-center gap-3">
            {isPaused && (
              <span className="text-xs text-primary font-medium bg-primary-soft px-2.5 py-1 rounded-full">
                {pausedRemaining}m remaining
              </span>
            )}
            <Toggle label="Pause notifications" disabled={isPausing} checked={pauseEnabled} onChange={(enabled) => { setPauseEnabled(enabled); if (enabled) handlePause(activeDuration); else handlePause(0); }} />
          </div>
        </div>
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${pauseEnabled ? "max-h-20 opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="flex gap-3 pt-1">
            {PAUSE_DURATIONS.map((opt) => (
              <button key={opt.hours} type="button" disabled={isPausing || !pauseEnabled}
                onClick={() => { setActiveDuration(opt.hours); handlePause(opt.hours); }}
                className={`flex-1 rounded-sm border text-sm font-medium px-3 py-2.5 transition-all disabled:opacity-50 ${activeDuration === opt.hours ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-muted-foreground bg-surface-subtle hover:border-input hover:text-muted-foreground"}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
