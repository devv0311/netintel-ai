/**
 * Deterministic minting of clearly-fictional synthetic identifiers.
 *
 * Every formatter here is designed so its output cannot be mistaken for a
 * real-world identifier (docs/requirements.md §10, §9;
 * docs/data/synthetic-investigation-spec.md §6):
 *
 * - Phone numbers use ITU country code "+99", which is unassigned — no
 *   real subscriber can hold one.
 * - IMEIs, bank accounts, vehicle plates, and transaction references all
 *   carry an explicit "SYN-" marker and do not follow any real format
 *   (no 15-digit Luhn IMEI, no IFSC, no real plate pattern).
 * - FIR numbers are namespaced "ODD/SYN/2025/NNN" (Operation DarkNet
 *   Delhi / SYNthetic).
 *
 * These are stable identity strings that appear inside evidence content.
 * They are NOT domain-row primary keys — those are assigned separately by
 * src/lib/domain/ids.ts (makeContentId) in the loader.
 *
 * Dependency-free (see config.ts).
 */

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** e.g. synPhone(1) -> "+99 70 000 0001" (country code 99 is unassigned). */
export function synPhone(n: number): string {
  const d = pad(n, 7);
  return `+99 70 ${d.slice(0, 3)} ${d.slice(3)}`;
}

/** e.g. "SYN-IMEI-0000001" — not a real 15-digit IMEI. */
export function synImei(n: number): string {
  return `SYN-IMEI-${pad(n, 7)}`;
}

/**
 * e.g. synAccount(4, "AC") -> "SYN-AC-000004". `kind` distinguishes
 * suspect accounts (AC), money-mule accounts (MA), and shell/front
 * accounts (SH) — no IFSC, no bank code, no real account format.
 */
export function synAccount(n: number, kind: "AC" | "MA" | "SH"): string {
  return `SYN-${kind}-${pad(n, 6)}`;
}

/** e.g. "SYN-VEH-0004" — not a real registration plate pattern. */
export function synVehicle(n: number): string {
  return `SYN-VEH-${pad(n, 4)}`;
}

/** e.g. "ODD/SYN/2025/001". */
export function synFir(n: number): string {
  return `ODD/SYN/2025/${pad(n, 3)}`;
}

/** e.g. "SYN-TXN-00000001". */
export function synTxn(n: number): string {
  return `SYN-TXN-${pad(n, 8)}`;
}

/** e.g. "SYN-CT-03" — a synthetic cell-tower identifier. */
export function synCellTower(n: number): string {
  return `SYN-CT-${pad(n, 2)}`;
}

/**
 * Patterns that must NEVER appear anywhere in generated corpus content —
 * used by the synthetic-safety test as a guard against accidentally
 * emitting something real-looking.
 */
export const FORBIDDEN_REAL_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "india-country-code-phone", re: /\+91[\s-]?\d/ },
  { name: "bare-10-digit-indian-mobile", re: /(^|[^\d+])[6-9]\d{9}([^\d]|$)/ },
  { name: "aadhaar-like-12-digit", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/ },
  { name: "ifsc-code", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/ },
  { name: "pan-card", re: /\b[A-Z]{5}\d{4}[A-Z]\b/ },
  { name: "15-digit-imei", re: /\b\d{15}\b/ },
];

/** Every synthetic identifier the corpus emits must match one of these. */
export const EXPECTED_SYNTHETIC_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "phone", re: /^\+99 70 \d{3} \d{4}$/ },
  { name: "imei", re: /^SYN-IMEI-\d{7}$/ },
  { name: "account", re: /^SYN-(AC|MA|SH)-\d{6}$/ },
  { name: "vehicle", re: /^SYN-VEH-\d{4}$/ },
  { name: "fir", re: /^ODD\/SYN\/2025\/\d{3}$/ },
  { name: "txn", re: /^SYN-TXN-\d{8}$/ },
  { name: "cell-tower", re: /^SYN-CT-\d{2}$/ },
];
