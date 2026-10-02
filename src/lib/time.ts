const DAY_NAMES: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

// Trigger.dev workers and CI machines resolve to Etc/UTC; the product default is Central US.
// ponytail: hardcoded fallback — revert to per-request tz detection only if users outside US show up.
export const FALLBACK_TIMEZONE = "America/Chicago";

/** Maximum recent-history display window. Completion records stay stored:
 *  deleting them allows Canvas sync to recreate locally completed work. */
export const COMPLETED_RETENTION_DAYS = 30;

export function getDefaultTimezone(): string {
  if (typeof window !== "undefined") {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  }
  return FALLBACK_TIMEZONE;
}

/**
 * Coerce a stored timezone to something Intl accepts. A malformed value must
 * never let Intl.DateTimeFormat throw — one bad profile row would otherwise
 * crash server routes and the whole nudge engine.
 */
export function coerceTimezone(tz: string | null | undefined): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      // fall through to default
    }
  }
  return getDefaultTimezone();
}

export function getLocalDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date);
}

export function getLocalHour(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
}

export function getLocalDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(date);
  return DAY_NAMES[parts.find((p) => p.type === "weekday")?.value ?? "Sun"] ?? 0;
}

/** "6:30 PM" — clock time of an absolute instant in the user's timezone. */
export function formatClockTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** "2 PM" — a bare hour-of-day, timezone-agnostic. Used for aggregate labels
 *  (peak hour, focus blocks) that span many dates; appending a tz abbreviation
 *  would take TODAY's DST state, which is wrong for half the year. */
export function formatLocalHour(hour: number, tz?: string): string {
  void tz; // kept for call-site API; bare hour is deliberate (see jsdoc)
  const normHour = ((hour % 24) + 24) % 24;
  const period = normHour >= 12 ? "PM" : "AM";
  const h12 = normHour === 0 ? 12 : normHour > 12 ? normHour - 12 : normHour;
  return `${h12} ${period}`;
}

export function getDayRange(date: Date, tz: string, days: number): string[] {
  // Step local CALENDAR days, not 24h chunks — on the 25-hour fall-back DST
  // day, plain +86400000 can emit the same local date twice (double-counting
  // that day in the 3-day stress windows).
  const result: string[] = [];
  let cursor = new Date(date);
  while (result.length < days) {
    const key = getLocalDate(cursor, tz);
    if (result[result.length - 1] !== key) result.push(key);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return result;
}
