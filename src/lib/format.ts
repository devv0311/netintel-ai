/**
 * Locale- and timezone-independent formatters, safe to render on both
 * the server and the client without a hydration mismatch. Numbers are
 * pinned to the `en-US` grouping ("1,820"); timestamps are shown as the
 * raw UTC value they are stored in.
 */

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "2026-01-01 00:00:00 UTC" from an ISO-8601 string. */
export function formatUtc(iso: string): string {
  if (iso.length < 19) return iso;
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}
