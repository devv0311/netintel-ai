/**
 * Deterministic temporal primitives for corroboration — time-window
 * comparison over already-persisted event timestamps. No timestamp is
 * ever invented; every value here is derived from an ISO-8601 instant
 * that came from a persisted `communication_events` row or an extracted
 * `event_mention` record.
 */

/**
 * Two events whose timestamps are within this many seconds of each
 * other are treated as temporally co-occurring. A documented, fixed
 * threshold (30 minutes) — long enough to catch "active around the same
 * time near the same place", short enough that unrelated day-apart
 * activity never collides.
 */
export const TEMPORAL_WINDOW_SECONDS = 30 * 60;

/**
 * An entity pair must overlap on at least this many separate occasions
 * for the overlap to be reported as a *repeated* spatial/temporal
 * pattern rather than a one-off.
 */
export const REPEATED_OCCURRENCE_MIN = 2;

/**
 * Implied point-to-point travel speed above this (~198 km/h) between
 * two placements of the SAME entity is reported as a spatiotemporal
 * contradiction — the two observations cannot both be simple truths.
 */
export const MAX_PLAUSIBLE_SPEED_MPS = 55;

/** Absolute gap between two ISO-8601 instants, in whole seconds. */
export function secondsBetween(isoA: string, isoB: string): number {
  return Math.round(Math.abs(Date.parse(isoA) - Date.parse(isoB)) / 1000);
}

/** True when two ISO-8601 instants are within `windowSeconds` of each other. */
export function withinWindow(isoA: string, isoB: string, windowSeconds: number = TEMPORAL_WINDOW_SECONDS): boolean {
  return secondsBetween(isoA, isoB) <= windowSeconds;
}

/** The UTC calendar day (YYYY-MM-DD) of an ISO-8601 instant — used to count "on N separate days". */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Implied constant travel speed (metres/second) to get from one
 * placement to another. `Infinity` when the two placements share a
 * timestamp but differ in location (an instantaneous jump).
 */
export function impliedSpeedMps(distanceMeters: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return distanceMeters > 0 ? Infinity : 0;
  return distanceMeters / elapsedSeconds;
}
