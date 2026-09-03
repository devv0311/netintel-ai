/**
 * Graph canvas color tokens — reads directly from the M10.2 `--kind-*` /
 * `--edge-*` custom properties in globals.css (client-only) instead of a
 * second, hardcoded palette, so canvas/WebGL rendering never drifts from
 * the rest of the dark operational visual system. Sigma/WebGL and the
 * canvas 2D API need concrete `rgb()`/`rgba()` strings, not `oklch()` —
 * `resolveToken` lets the browser do that conversion once per token by
 * reading it back off a computed style, then caches the result.
 */

export const NODE_KINDS = ["person", "organisation", "phone", "imei", "vehicle", "bank_account", "location"] as const;
export type GraphNodeKind = (typeof NODE_KINDS)[number] | "other";

export const KIND_LABELS: Record<string, string> = {
  person: "Person",
  organisation: "Organisation",
  phone: "Phone",
  imei: "IMEI",
  vehicle: "Vehicle",
  bank_account: "Bank account",
  location: "Location",
  other: "Other",
};

export const KIND_VAR: Record<string, string> = {
  person: "--kind-person",
  organisation: "--kind-organisation",
  phone: "--kind-phone",
  imei: "--kind-imei",
  vehicle: "--kind-vehicle",
  bank_account: "--kind-bank-account",
  location: "--kind-location",
  other: "--kind-other",
};

export const EDGE_TYPES = [
  "ownership",
  "communication",
  "financial",
  "co_location",
  "family",
  "associate",
  "other",
] as const;
export type GraphEdgeType = (typeof EDGE_TYPES)[number];

export const EDGE_LABELS: Record<string, string> = {
  ownership: "Ownership",
  communication: "Communication",
  financial: "Financial",
  co_location: "Co-location",
  family: "Family",
  associate: "Associate",
  other: "Other",
};

export const EDGE_VAR: Record<string, string> = {
  ownership: "--edge-ownership",
  communication: "--edge-communication",
  financial: "--edge-financial",
  co_location: "--edge-co-location",
  family: "--edge-family",
  associate: "--edge-associate",
  other: "--edge-other",
};

const colorCache = new Map<string, string>();
let probeEl: HTMLElement | null = null;
let probeCtx: CanvasRenderingContext2D | null = null;

/**
 * Resolves a `--kind-*` / `--edge-*` / theme custom property to an
 * `rgb()`/`rgba()` string the canvas 2D and WebGL layers can consume,
 * honoring whichever theme is actually applied. Client-only; cached for
 * the page's lifetime.
 *
 * Two steps, both necessary: (1) `getComputedStyle` on a live element
 * resolves the `var()` and cascade, but Chromium serializes the
 * underlying `oklch()` tokens back out as `lab(...)`, which sigma's
 * color parser (hex / `rgb()`/`rgba()` only — see its bundled
 * `colors-*.js` chunk) silently reads as opaque black; (2) painting that
 * resolved color onto a real canvas pixel and reading it back always
 * yields sRGB bytes, regardless of the source color space, so it's a
 * format sigma can parse.
 */
export function resolveToken(varName: string, fallback = "#64748b"): string {
  const cached = colorCache.get(varName);
  if (cached) return cached;
  if (typeof document === "undefined") return fallback;
  if (!probeEl) {
    probeEl = document.createElement("span");
    probeEl.style.position = "absolute";
    probeEl.style.visibility = "hidden";
    probeEl.style.pointerEvents = "none";
    document.body.appendChild(probeEl);
  }
  if (!probeCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probeCtx = canvas.getContext("2d");
  }
  probeEl.style.color = `var(${varName})`;
  const computed = getComputedStyle(probeEl).color;
  if (!computed || !probeCtx) return fallback;

  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = computed;
  probeCtx.fillRect(0, 0, 1, 1);
  const pixel = probeCtx.getImageData(0, 0, 1, 1).data;
  const r = pixel[0] ?? 0;
  const g = pixel[1] ?? 0;
  const b = pixel[2] ?? 0;
  const a = pixel[3] ?? 255;
  const resolved = a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  colorCache.set(varName, resolved);
  return resolved;
}

/** Returns `rgb(...)`/`rgba(...)` re-expressed with the given alpha — used to dim non-neighborhood nodes/edges without a second color system. */
export function withAlpha(rgbColor: string, alpha: number): string {
  const match = rgbColor.match(/rgba?\(([^)]+)\)/);
  if (!match) return rgbColor;
  const parts = (match[1] ?? "").split(",").map((s) => s.trim());
  const [r, g, b] = [parts[0] ?? "0", parts[1] ?? "0", parts[2] ?? "0"];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
