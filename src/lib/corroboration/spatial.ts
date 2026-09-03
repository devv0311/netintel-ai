/**
 * Deterministic spatial primitives for corroboration — the "existing
 * approved project approach" per docs/architecture/stack-contract.md
 * ("Spatial analysis | Haversine distance + time-window queries in
 * TypeScript"). No PostGIS, no external geo dependency, no invented
 * coordinate: every distance is computed from two `locations` rows'
 * already-persisted latitude/longitude.
 */

/**
 * Two distinct persisted case locations within this many metres of each
 * other — at least one carrying recorded entity activity — are reported
 * as a spatial-proximity signal. A documented, fixed threshold (not
 * learned/tunable), consistent with the project's deterministic-first
 * design. ~1 km is a conservative upper bound on urban macro-cell
 * coverage radius, so two sites this close plausibly fall within the
 * same tower's footprint. Always an `algorithmic_signal` — proximity is
 * never "they were together".
 */
export const SPATIAL_PROXIMITY_METERS = 1000;

/**
 * Great-circle distance between two WGS-84 points, in whole metres
 * (haversine formula, IUGG mean Earth radius). Rounded to an integer so
 * float summation-order noise can never leak into a persisted or
 * presented value — the same discipline src/lib/analytics/build.ts
 * applies to its metrics.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_008.8; // IUGG mean Earth radius (metres)
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/** True when two persisted locations are within `SPATIAL_PROXIMITY_METERS` and are not the exact same point. */
export function isNearby(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
  thresholdMeters: number = SPATIAL_PROXIMITY_METERS,
): boolean {
  const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  return d > 0 && d <= thresholdMeters;
}
