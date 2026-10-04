import { coerceTimezone, getLocalHour } from "@/lib/time";

type Preferences = {
  timezone: string | null;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  nudge_paused_until: string | null;
};

/** Missing preferences must never turn a pause or quiet hours off. */
export function canNotify(profile: Preferences | null | undefined, now: Date): boolean {
  if (!profile) return false;
  if (profile.nudge_paused_until && Date.parse(profile.nudge_paused_until) > now.getTime()) return false;
  const { quiet_hours_start: start, quiet_hours_end: end } = profile;
  if (start === null || end === null || start === end) return true;
  const hour = getLocalHour(now, coerceTimezone(profile.timezone));
  return !(start < end ? hour >= start && hour < end : hour >= start || hour < end);
}
