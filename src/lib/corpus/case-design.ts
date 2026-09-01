/**
 * Operation DarkNet Delhi — the case design ("A1 manifest", per
 * docs/implementation-blueprint.md §4 Task A1), expressed as data.
 *
 * This is the top-down narrative the generator (generate.ts) expands
 * into ~1,700 evidence records and the ground truth (ground-truth.ts)
 * encodes the answer key for. Everything here is entirely fictional.
 *
 * Every structural property required by
 * docs/data/synthetic-investigation-spec.md §4 is realized here and
 * tagged with a `// [spec §4: ...]` note where it is introduced:
 *
 *   - aliases                         → SUSPECTS[*].aliases, ALIAS_RECORDS
 *   - duplicate / ambiguous identity  → DUPLICATE_MENTIONS, DO_NOT_MERGE
 *   - conflicting statements          → CONTRADICTIONS
 *   - indirect relationships          → INDIRECT_RELATIONSHIPS
 *   - temporal correlations           → TEMPORAL_CORRELATIONS
 *   - intermediary actors             → INTERMEDIARIES
 *   - money-mule patterns             → MULE_PATH, TXN_FLOWS(kind:"mule")
 *   - misleading low-value relations  → MISLEADING_RELATIONSHIPS
 *   - known hidden relationship       → HIDDEN_CONNECTION
 *
 * Dependency-free (see config.ts).
 */

export type PartyKey =
  | `S${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | "M1"
  | "M2"
  | "M3"
  | "X1"
  | "W6";

export interface SuspectDesign {
  key: `S${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
  name: string;
  role: string;
  /** [spec §4: aliases] additional names/handles this suspect is known by. */
  aliases: string[];
  phones: number; // how many phone_records / numbers this suspect holds
  accounts: number; // how many bank_account_records
  vehicles: number;
  homeTowers: string[]; // cell towers this suspect's phones mostly hit
  residence: string; // ADDRESS key
}

/** The 8 primary suspects (docs/data/synthetic-investigation-spec.md §3). */
export const SUSPECTS: readonly SuspectDesign[] = [
  {
    key: "S1",
    name: "Rohan Malhotra",
    role: "Organising principal / financier of the BlackBazaar-DEL marketplace",
    aliases: ["RM", "Bhai", "Silver Fox", "SilkFox"],
    phones: 2,
    accounts: 1,
    vehicles: 1,
    homeTowers: ["SYN-CT-01", "SYN-CT-07"],
    residence: "ADDR-01",
  },
  {
    key: "S2",
    name: "Anjali Verma",
    role: "Logistics coordinator",
    aliases: ["AV", "Didi"],
    phones: 1,
    accounts: 1,
    vehicles: 0,
    homeTowers: ["SYN-CT-03", "SYN-CT-05"],
    residence: "ADDR-02",
  },
  {
    key: "S3",
    name: "Kabir Sharma",
    role: "Darknet vendor / marketplace listings operator",
    aliases: ["KS", "Chhotu"],
    phones: 2,
    accounts: 1,
    vehicles: 0,
    homeTowers: ["SYN-CT-03", "SYN-CT-04"],
    residence: "ADDR-02",
  },
  {
    key: "S4",
    name: "Farhan Qureshi",
    role: "Chemist / production",
    aliases: ["FQ", "Doctor"],
    phones: 1,
    accounts: 1,
    vehicles: 0,
    homeTowers: ["SYN-CT-07", "SYN-CT-08"],
    residence: "ADDR-03",
  },
  {
    key: "S5",
    name: "Vikram Singh",
    role: "Enforcement",
    aliases: ["VS", "Major"],
    phones: 1,
    accounts: 1,
    vehicles: 1,
    homeTowers: ["SYN-CT-02", "SYN-CT-06"],
    residence: "ADDR-01",
  },
  {
    key: "S6",
    name: "Neha Kapoor",
    role: "Front-business owner (Kapoor Trading (Synthetic) Pvt Ltd) / laundering",
    aliases: ["NK", "Madam"],
    phones: 1,
    accounts: 2, // one personal, one shell/front
    vehicles: 0,
    homeTowers: ["SYN-CT-05", "SYN-CT-01"],
    residence: "ADDR-01",
  },
  {
    key: "S7",
    name: "Imran Sheikh",
    role: "Courier network lead",
    aliases: ["IS", "Chacha"],
    phones: 1,
    accounts: 1,
    vehicles: 1,
    homeTowers: ["SYN-CT-04", "SYN-CT-06"],
    residence: "ADDR-02",
  },
  {
    key: "S8",
    name: "Deepak Yadav",
    role: "Hawala / informal-value-transfer operator",
    aliases: ["DY", "Guru"],
    phones: 1,
    accounts: 1,
    vehicles: 0,
    homeTowers: ["SYN-CT-06", "SYN-CT-02"],
    residence: "ADDR-03",
  },
] as const;

export interface IntermediaryDesign {
  key: "M1" | "M2" | "M3" | "X1";
  name: string;
  /** [spec §4: intermediary actors] */
  role: "money_mule" | "communication_intermediary";
  phones: number;
  accounts: number;
  homeTowers: string[];
}

/**
 * [spec §4: intermediary actors] Non-suspect actors whose only narrative
 * purpose is to connect principals who never contact each other directly.
 */
export const INTERMEDIARIES: readonly IntermediaryDesign[] = [
  {
    key: "M1",
    name: "Sunil Gupta",
    role: "money_mule",
    phones: 1,
    accounts: 1,
    homeTowers: ["SYN-CT-01"],
  },
  {
    key: "M2",
    name: "Pooja Rani",
    role: "money_mule",
    phones: 1,
    accounts: 1,
    homeTowers: ["SYN-CT-05"],
  },
  {
    key: "M3",
    name: "Ashok Kumar",
    role: "money_mule",
    phones: 1,
    accounts: 1,
    homeTowers: ["SYN-CT-08"],
  },
  {
    key: "X1",
    name: "Rahul Mehta",
    role: "communication_intermediary",
    phones: 1,
    accounts: 0,
    homeTowers: ["SYN-CT-04"],
  },
] as const;

/** Service numbers used only to seed misleading noise (not parties). */
export const NOISE_NUMBERS: readonly { key: string; label: string }[] = [
  { key: "PN1", label: "Synthetic food-delivery hotline" },
  { key: "PN2", label: "Synthetic dental clinic reception" },
  { key: "PN3", label: "Synthetic radio-cab dispatch" },
] as const;

export interface LocationDesign {
  key: string;
  label: string;
  locationType: "cell_tower" | "crime_scene" | "address";
  latitude: number;
  longitude: number;
}

/** ~14 fixed synthetic locations inside the Delhi-NCR bounding box. */
export const LOCATIONS: readonly LocationDesign[] = [
  { key: "SYN-CT-01", label: "Synthetic Cell Tower CT-01 (sector grid A)", locationType: "cell_tower", latitude: 28.6512, longitude: 77.2043 },
  { key: "SYN-CT-02", label: "Synthetic Cell Tower CT-02 (sector grid B)", locationType: "cell_tower", latitude: 28.6431, longitude: 77.1902 },
  { key: "SYN-CT-03", label: "Synthetic Cell Tower CT-03 (sector grid C)", locationType: "cell_tower", latitude: 28.6702, longitude: 77.2288 },
  { key: "SYN-CT-04", label: "Synthetic Cell Tower CT-04 (sector grid D)", locationType: "cell_tower", latitude: 28.5921, longitude: 77.0461 },
  { key: "SYN-CT-05", label: "Synthetic Cell Tower CT-05 (sector grid E)", locationType: "cell_tower", latitude: 28.7405, longitude: 77.1179 },
  { key: "SYN-CT-06", label: "Synthetic Cell Tower CT-06 (sector grid F)", locationType: "cell_tower", latitude: 28.5083, longitude: 77.2711 },
  { key: "SYN-CT-07", label: "Synthetic Cell Tower CT-07 (sector grid G)", locationType: "cell_tower", latitude: 28.4791, longitude: 77.1024 },
  { key: "SYN-CT-08", label: "Synthetic Cell Tower CT-08 (sector grid H)", locationType: "cell_tower", latitude: 28.8244, longitude: 77.3018 },
  { key: "CS-01", label: "Fictional crime scene — Karol Bagh warehouse (synthetic)", locationType: "crime_scene", latitude: 28.6519, longitude: 77.1901 },
  { key: "CS-02", label: "Fictional crime scene — Chhatarpur farmhouse lab (synthetic)", locationType: "crime_scene", latitude: 28.4802, longitude: 77.1789 },
  { key: "CS-03", label: "Fictional crime scene — Paharganj guesthouse (synthetic)", locationType: "crime_scene", latitude: 28.6449, longitude: 77.2140 },
  { key: "ADDR-01", label: "Fictional residence ADDR-01 (synthetic)", locationType: "address", latitude: 28.6555, longitude: 77.2010 },
  { key: "ADDR-02", label: "Fictional residence ADDR-02 (synthetic)", locationType: "address", latitude: 28.6688, longitude: 77.2301 },
  { key: "ADDR-03", label: "Fictional residence ADDR-03 (synthetic)", locationType: "address", latitude: 28.4990, longitude: 77.0899 },
] as const;

export interface CrimeEventDesign {
  key: "C1" | "C2" | "C3" | "C4";
  firNumber: number;
  sceneKey: string;
  nearestTower: string;
  occurredAt: string;
  summary: string;
}

export const CRIME_EVENTS: readonly CrimeEventDesign[] = [
  {
    key: "C1",
    firNumber: 3,
    sceneKey: "CS-01",
    nearestTower: "SYN-CT-02",
    occurredAt: "2025-07-19T22:00:00.000Z",
    summary: "Contraband seizure at the Karol Bagh warehouse; one vehicle impounded.",
  },
  {
    key: "C2",
    firNumber: 4,
    sceneKey: "CS-02",
    nearestTower: "SYN-CT-07",
    occurredAt: "2025-08-15T00:20:00.000Z",
    summary: "Raid on the Chhatarpur farmhouse production lab.",
  },
  {
    key: "C3",
    firNumber: 5,
    sceneKey: "CS-03",
    nearestTower: "SYN-CT-04",
    occurredAt: "2025-08-28T16:30:00.000Z",
    summary: "Courier interception on the NH-48 corridor (synthetic).",
  },
  {
    key: "C4",
    firNumber: 5,
    sceneKey: "CS-03",
    nearestTower: "SYN-CT-06",
    occurredAt: "2025-09-05T11:15:00.000Z",
    summary: "Informal-value-transfer (hawala) transaction interdiction at Paharganj.",
  },
] as const;

export interface FirDesign {
  n: number;
  filedAt: string;
  accused: PartyKey[];
  summary: string;
}

/** Exactly 5 FIRs (docs/data/synthetic-investigation-spec.md §3). */
export const FIRS: readonly FirDesign[] = [
  {
    n: 1,
    filedAt: "2025-06-04T09:30:00.000Z",
    accused: ["S1", "S3"],
    summary:
      "Originating report: operation of the darknet marketplace 'BlackBazaar-DEL' for trafficking of controlled substances. Names Rohan Malhotra and Kabir Sharma.",
  },
  {
    n: 2,
    filedAt: "2025-06-21T14:05:00.000Z",
    accused: ["S1", "S6"],
    summary:
      "Financial angle: suspected layering of marketplace proceeds through 'Kapoor Trading (Synthetic) Pvt Ltd'. Names Neha Kapoor and Rohan Malhotra.",
  },
  {
    n: 3,
    filedAt: "2025-07-20T08:15:00.000Z",
    accused: ["S5", "S2"],
    summary:
      "Warehouse seizure (crime event C1). Names Vikram Singh ('Major') and Anjali Verma. Seized vehicle recorded as SYN-VEH-0004, colour white.",
  },
  {
    n: 4,
    filedAt: "2025-08-16T07:40:00.000Z",
    accused: ["S4", "S7"],
    summary:
      "Production-lab raid (crime event C2). Names Farhan Qureshi ('Doctor') and Imran Sheikh.",
  },
  {
    n: 5,
    filedAt: "2025-09-06T10:00:00.000Z",
    accused: ["S7", "S8", "S2"],
    summary:
      "Courier network and hawala settlement (crime events C3, C4). Names Imran Sheikh, Deepak Yadav and Anjali Verma.",
  },
] as const;

export type CommIntensity = "high" | "medium" | "low";

export interface CommPairDesign {
  a: PartyKey;
  b: PartyKey;
  intensity: CommIntensity;
  /** [spec §4: misleading low-value] true → immaterial noise link. */
  noise?: boolean;
}

/**
 * The designed communication graph. Principals talk to lieutenants and to
 * intermediaries, never (directly) across the vendor/courier divide —
 * that gap is bridged only through X1.
 */
export const COMM_PAIRS: readonly CommPairDesign[] = [
  { a: "S1", b: "S2", intensity: "high" },
  { a: "S1", b: "S3", intensity: "high" },
  { a: "S1", b: "S6", intensity: "medium" },
  { a: "S1", b: "M1", intensity: "medium" },
  { a: "S2", b: "S3", intensity: "high" },
  { a: "S2", b: "S5", intensity: "high" },
  { a: "S2", b: "S6", intensity: "medium" },
  { a: "S2", b: "S7", intensity: "medium" },
  { a: "S3", b: "S4", intensity: "high" },
  { a: "S3", b: "X1", intensity: "high" }, // [spec §4: intermediary] vendor side ↔ X1
  { a: "S4", b: "M3", intensity: "low" },
  { a: "S5", b: "S7", intensity: "medium" },
  { a: "S6", b: "M1", intensity: "medium" },
  { a: "S7", b: "S8", intensity: "high" },
  { a: "S7", b: "X1", intensity: "high" }, // [spec §4: intermediary] courier side ↔ X1
  { a: "S8", b: "M2", intensity: "low" },
  { a: "M1", b: "M2", intensity: "low" },
  { a: "M2", b: "M3", intensity: "low" },
  { a: "S1", b: "S2", intensity: "medium" }, // second S1↔S2 line (S1's other phone)
  { a: "S3", b: "S2", intensity: "medium" },
  { a: "S4", b: "S7", intensity: "low" },
  // [spec §4: misleading low-value relationships] — real links, immaterial:
  { a: "S2", b: "S8", intensity: "low", noise: true },
  { a: "S7", b: "PN1" as PartyKey, intensity: "medium", noise: true },
  { a: "S4", b: "PN2" as PartyKey, intensity: "low", noise: true },
  { a: "S5", b: "PN3" as PartyKey, intensity: "low", noise: true },
] as const;

export type TxnFlowKind = "operational" | "mule" | "salary" | "noise";

export interface TxnFlowDesign {
  from: PartyKey;
  to: PartyKey;
  kind: TxnFlowKind;
  count: number;
  amountMin: number;
  amountMax: number;
}

/**
 * Designed fund flows. The `mule` rows form the laundering chain
 * (see MULE_PATH); `noise` rows are the immaterial low-value transfers.
 */
export const TXN_FLOWS: readonly TxnFlowDesign[] = [
  { from: "S3", to: "S1", kind: "operational", count: 60, amountMin: 8000, amountMax: 45000 },
  { from: "S1", to: "S2", kind: "operational", count: 48, amountMin: 5000, amountMax: 30000 },
  { from: "S2", to: "S5", kind: "salary", count: 24, amountMin: 12000, amountMax: 18000 },
  { from: "S2", to: "S7", kind: "operational", count: 40, amountMin: 4000, amountMax: 22000 },
  { from: "S7", to: "S8", kind: "operational", count: 52, amountMin: 6000, amountMax: 28000 },
  { from: "S8", to: "S4", kind: "operational", count: 30, amountMin: 9000, amountMax: 40000 },
  { from: "S1", to: "M1", kind: "mule", count: 40, amountMin: 40000, amountMax: 48000 },
  { from: "M1", to: "M2", kind: "mule", count: 38, amountMin: 38000, amountMax: 46000 },
  { from: "M2", to: "M3", kind: "mule", count: 36, amountMin: 36000, amountMax: 44000 },
  { from: "M3", to: "S6", kind: "mule", count: 34, amountMin: 34000, amountMax: 43000 },
  { from: "M3", to: "S4", kind: "operational", count: 18, amountMin: 15000, amountMax: 30000 }, // [spec §4: hidden] pays the chemist
  { from: "S6", to: "S1", kind: "operational", count: 26, amountMin: 20000, amountMax: 60000 },
  { from: "S6", to: "M1", kind: "salary", count: 20, amountMin: 8000, amountMax: 12000 },
  { from: "S1", to: "S6", kind: "operational", count: 22, amountMin: 10000, amountMax: 35000 },
  // [spec §4: misleading low-value relationships]:
  { from: "S2", to: "S8", kind: "noise", count: 6, amountMin: 200, amountMax: 500 },
  { from: "S5", to: "S8", kind: "noise", count: 4, amountMin: 150, amountMax: 400 },
] as const;

/**
 * [spec §4: money-mule pattern] The laundering path, by account role.
 * Reconstructable from financial_transaction_record contents by walking
 * fromAccount → toAccount from the first hop to the last.
 */
export const MULE_PATH: readonly { holder: PartyKey; accountKind: "AC" | "MA" | "SH" }[] = [
  { holder: "S1", accountKind: "AC" },
  { holder: "M1", accountKind: "MA" },
  { holder: "M2", accountKind: "MA" },
  { holder: "M3", accountKind: "MA" },
  { holder: "S6", accountKind: "SH" },
] as const;

export interface WitnessDesign {
  key: string;
  about: PartyKey[];
  text: string;
  corroborates?: string;
  /** [spec §4: conflicting statements] key of the statement this conflicts with. */
  contradicts?: string;
}

export const WITNESS_STATEMENTS: readonly WitnessDesign[] = [
  { key: "W1", about: ["S1"], text: "States that 'Bhai' (identified as Rohan Malhotra) directed marketplace operations and rarely handled product personally." },
  { key: "W2", about: ["S1", "S3"], text: "Says the marketplace handle 'SilkFox' belongs to Rohan M. ('Silver Fox'); Kabir Sharma only posted listings on instruction.", contradicts: "W9" },
  { key: "W3", about: ["S5"], text: "Places 'Major' (Vikram Singh) at the Karol Bagh warehouse around 22:00 on 19 July, loading crates into a vehicle.", corroborates: "C1" },
  { key: "W4", about: ["S2", "S6"], text: "Describes Anjali Verma handing paperwork to Neha Kapoor at the Kapoor Trading office in early August." },
  { key: "W5", about: ["S5"], text: "Describes the getaway vehicle from the warehouse as SYN-VEH-0004, silver in colour.", contradicts: "FIR3" },
  { key: "W6", about: ["W6"], text: "Bystander named Vikram Singh (a different individual from the accused 'Major') who reported hearing raised voices near ADDR-02; unrelated to the network." },
  { key: "W7", about: ["S5"], text: "Claims Vikram Singh ('Major') attended a family wedding in Noida on the evening of 19 July and could not have been at the warehouse.", contradicts: "W3" },
  { key: "W8", about: ["S7", "X1"], text: "Recalls Imran Sheikh frequently phoning a contact he called 'Rahul' to coordinate pickups." },
  { key: "W9", about: ["S3"], text: "Asserts the 'SilkFox' handle is Kabir Sharma's own and that he ran the marketplace independently.", contradicts: "W2" },
  { key: "W10", about: ["S4", "S7"], text: "Places Farhan Qureshi and Imran Sheikh together at the Chhatarpur farmhouse the week before the raid." },
] as const;

/**
 * [spec §4: conflicting statements] Explicit contradiction set — the
 * answer key a contradiction-detection stage should recover, without
 * inventing spurious ones.
 */
export const CONTRADICTIONS: readonly {
  kind: "location_time" | "attribute" | "attribution";
  sources: string[];
  subject: string;
  detail: string;
}[] = [
  {
    kind: "location_time",
    sources: ["witness:W3", "witness:W7"],
    subject: "S5 (Vikram Singh, 'Major') whereabouts on 2025-07-19 ~22:00",
    detail:
      "W3 places S5 at the Karol Bagh warehouse (CS-01); W7 gives an alibi of a wedding in Noida. CDR for S5's phone on SYN-CT-02 at ~22:05 supports W3. The contradiction must be surfaced, not silently resolved.",
  },
  {
    kind: "attribute",
    sources: ["fir:003", "witness:W5"],
    subject: "Colour of seized vehicle SYN-VEH-0004",
    detail: "FIR 3 records the vehicle as white; W5 describes it as silver.",
  },
  {
    kind: "attribution",
    sources: ["witness:W2", "witness:W9"],
    subject: "Owner of the darknet handle 'SilkFox'",
    detail:
      "W2 attributes 'SilkFox' to S1 (operated by S3 on instruction); W9 attributes it solely to S3. Both cannot be simple truths.",
  },
] as const;

/**
 * [spec §4: temporal correlations] Time-window correlations designed into
 * the CDR stream. The generator injects CDR rows that realize each of
 * these; ground truth lists them as the recall target.
 */
export const TEMPORAL_CORRELATIONS: readonly {
  key: string;
  phones: PartyKey[];
  cellTower: string;
  windowStart: string;
  windowEnd: string;
  meaning: string;
}[] = [
  {
    key: "TC-hidden-S1-S4",
    phones: ["S1", "S4"],
    cellTower: "SYN-CT-07",
    windowStart: "2025-08-14T23:05:00.000Z",
    windowEnd: "2025-08-14T23:35:00.000Z",
    meaning:
      "S1's second phone and S4's phone are co-active on the tower covering the future lab-raid site — the only direct-presence link between the financier and the chemist.",
  },
  {
    key: "TC-S3-S7-via-X1",
    phones: ["S3", "S7"],
    cellTower: "SYN-CT-04",
    windowStart: "2025-07-05T10:00:00.000Z",
    windowEnd: "2025-08-20T11:00:00.000Z",
    meaning:
      "On six separate days S3 and S7 each call X1 within the same hour — the recurring bridge between the vendor and courier sub-cells.",
  },
  {
    key: "TC-S5-C1",
    phones: ["S5"],
    cellTower: "SYN-CT-02",
    windowStart: "2025-07-19T21:50:00.000Z",
    windowEnd: "2025-07-19T22:20:00.000Z",
    meaning: "S5's phone on the tower nearest CS-01 at the time of crime event C1 — corroborates W3, contradicts W7.",
  },
  {
    key: "TC-S2-S6-handoff",
    phones: ["S2", "S6"],
    cellTower: "SYN-CT-05",
    windowStart: "2025-08-02T09:15:00.000Z",
    windowEnd: "2025-08-02T10:00:00.000Z",
    meaning: "S2 and S6 co-active near the Kapoor Trading front office during the paperwork handoff W4 describes.",
  },
] as const;

/**
 * [spec §4: known hidden relationship] The 'hero' finding: S1 and S4 have
 * no direct call and no direct transaction anywhere in the corpus. Their
 * connection is recoverable only by combining the fund path and the
 * CT-07 co-location above.
 */
export const HIDDEN_CONNECTION = {
  between: ["S1", "S4"] as PartyKey[],
  reason:
    "The financier (S1) and the chemist (S4) are operationally linked but insulated: money reaches S4 only after laundering (S1→M1→M2→M3, then M3→S4), and the only presence link is the SYN-CT-07 co-activation on 2025-08-14.",
  evidenceChain: [
    "financial: SYN-AC-000001 (S1) → SYN-MA-000001 (M1) → SYN-MA-000002 (M2) → SYN-MA-000003 (M3)",
    "financial: SYN-MA-000003 (M3) → SYN-AC-000004 (S4) operational payments",
    "cdr: S1 phone #2 and S4 phone co-active on SYN-CT-07 within 2025-08-14T23:05Z–23:35Z",
    "crime: SYN-CT-07 covers CS-02, the site of lab raid C2",
  ],
  recoverableBy: ["transaction-path-analysis", "temporal-spatial-cdr-correlation"],
} as const;

/**
 * [spec §4: indirect relationships] Connections true in the data but
 * stated nowhere explicitly — only reachable by traversal/correlation.
 */
export const INDIRECT_RELATIONSHIPS: readonly {
  key: string;
  between: PartyKey[];
  via: string;
  detail: string;
}[] = [
  {
    key: "IR-S1-S4-hidden",
    between: ["S1", "S4"],
    via: "mule chain + CT-07 co-location",
    detail: "See HIDDEN_CONNECTION — the case's primary hidden link.",
  },
  {
    key: "IR-S3-S7-viaX1",
    between: ["S3", "S7"],
    via: "X1 (Rahul Mehta) shared phone contact",
    detail:
      "S3 and S7 never call each other; both call X1. X1 is the sole connector between the vendor and courier sub-cells.",
  },
  {
    key: "IR-S1-S6-viaMules",
    between: ["S1", "S6"],
    via: "SYN-MA-000001/2/3 (mules M1–M3)",
    detail:
      "S1 and S6 have only light direct contact; the material link is the laundering path that terminates in S6's shell account.",
  },
] as const;

/**
 * [spec §4: misleading low-value relationships] Real but immaterial links
 * the analytics/Copilot must not over-weight. No evidence record carries
 * a 'noise' label — the pipeline has to judge materiality itself.
 */
export const MISLEADING_RELATIONSHIPS: readonly {
  key: string;
  between: PartyKey[] | string[];
  type: "communication" | "financial";
  detail: string;
}[] = [
  { key: "MR-S2-S8-transfers", between: ["S2", "S8"], type: "financial", detail: "Six transfers of ₹200–₹500 — shared personal expenses, not case funds." },
  { key: "MR-S5-S8-transfers", between: ["S5", "S8"], type: "financial", detail: "Four transfers of ₹150–₹400 — immaterial." },
  { key: "MR-S7-PN1", between: ["S7", "PN1 (food delivery)"], type: "communication", detail: "Repeated calls to a food-delivery hotline." },
  { key: "MR-S4-PN2", between: ["S4", "PN2 (dental clinic)"], type: "communication", detail: "Calls to a dental clinic." },
  { key: "MR-S5-PN3", between: ["S5", "PN3 (radio cab)"], type: "communication", detail: "Calls to a cab dispatch line." },
] as const;

/**
 * [spec §4: duplicate / ambiguous identities] Mention variants that must
 * resolve to one entity (over-splitting risk) plus look-alikes that must
 * NOT merge (over-merging risk).
 */
export const DUPLICATE_MENTIONS: readonly {
  entityKey: PartyKey;
  variants: string[];
}[] = [
  { entityKey: "S1", variants: ["Rohan Malhotra", "R. Malhotra", "Rohan M.", "Malhotra, Rohan"] },
  { entityKey: "S3", variants: ["Kabir Sharma", "Kabir Sharman", "K. Sharma"] },
  { entityKey: "S6", variants: ["Neha Kapoor", "N. Kapoor", "Neha K."] },
] as const;

/** [spec §4: ambiguous identities] Same common name, different people. */
export const DO_NOT_MERGE: readonly {
  a: string;
  b: string;
  reason: string;
}[] = [
  {
    a: "S5 — Vikram Singh ('Major'), the accused enforcer",
    b: "W6 — Vikram Singh, an unrelated bystander witness",
    reason: "Identical common name; different individuals with no shared phone, account, or location.",
  },
] as const;

export const EXPECTED_COMMUNITIES: readonly { key: string; members: PartyKey[] }[] = [
  { key: "vendor-cell", members: ["S1", "S3", "S4", "X1"] },
  { key: "logistics-courier-cell", members: ["S2", "S5", "S7", "S8", "X1"] },
  { key: "laundering-cell", members: ["S1", "S6", "M1", "M2", "M3"] },
];

export const EXPECTED_SIGNALS: readonly {
  entityKey: PartyKey;
  signal: string;
  rationale: string;
}[] = [
  { entityKey: "X1", signal: "highest_betweenness_centrality", rationale: "Sole connector between the vendor and courier sub-cells." },
  { entityKey: "S1", signal: "highest_overall_influence", rationale: "Reaches every sub-cell, though only through intermediaries." },
  { entityKey: "M2", signal: "high_betweenness_on_fund_graph", rationale: "Middle hop of the four-hop laundering chain." },
];

/**
 * Fixes the entity placeholders the demo contract
 * (docs/demo/demo-contract.md §3) leaves open "once the case is
 * generated". Recorded here and in docs/data/corpus.md; the demo
 * contract document itself is not edited by this milestone.
 */
export const DEMO_QUESTION_BINDINGS = {
  q2Pair: ["S3", "S7"] as PartyKey[], // direct relationship? (requires traversal → none, only via X1)
  q3Pair: ["S1", "S6"] as PartyKey[], // financial connection + path (the mule chain)
  q7Intermediary: "X1" as PartyKey, // intermediary linked to >1 principal
} as const;
