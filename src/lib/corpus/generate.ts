import {
  CASE_START,
  CASE_END,
  CORPUS_CURRENCY,
  CORPUS_DESCRIPTION,
  CORPUS_GENERATED_AT,
  CORPUS_NAME,
  CORPUS_SEED,
  CORPUS_VERSION,
  GENERATION_TARGETS,
} from "./config";
import { makePrng, type Prng } from "./prng";
import {
  synAccount,
  synFir,
  synImei,
  synPhone,
  synTxn,
  synVehicle,
} from "./synthetic-identifiers";
import {
  COMM_PAIRS,
  CONTRADICTIONS,
  CRIME_EVENTS,
  DEMO_QUESTION_BINDINGS,
  DO_NOT_MERGE,
  DUPLICATE_MENTIONS,
  EXPECTED_COMMUNITIES,
  EXPECTED_SIGNALS,
  FIRS,
  HIDDEN_CONNECTION,
  INDIRECT_RELATIONSHIPS,
  INTERMEDIARIES,
  LOCATIONS,
  MISLEADING_RELATIONSHIPS,
  MULE_PATH,
  NOISE_NUMBERS,
  SUSPECTS,
  TEMPORAL_CORRELATIONS,
  TXN_FLOWS,
  WITNESS_STATEMENTS,
  type PartyKey,
} from "./case-design";
import type { CorpusGroundTruth, CorpusManifest } from "./manifest-schema";

/**
 * The deterministic Operation DarkNet Delhi generator.
 *
 * `generateCorpusManifest()` and `generateGroundTruth()` are pure
 * functions of (CORPUS_VERSION, CORPUS_SEED) via a single seeded PRNG
 * drawn in a fixed order — running either twice yields structurally
 * identical output (docs/requirements.md §6;
 * docs/data/synthetic-investigation-spec.md §5). Neither reads the
 * filesystem, the network, or any clock.
 *
 * The manifest is the APPLICATION EVIDENCE the pipeline may process; the
 * ground truth is the held-out answer key and is produced by a separate
 * function that the evidence path never calls (see load.ts).
 */

const MS_PER_HOUR = 3_600_000;

function isoAt(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

interface Party {
  key: PartyKey;
  name: string;
  phones: string[];
  imeis: string[];
  accounts: string[];
  vehicles: string[];
  homeTowers: string[];
}

interface Registry {
  parties: Map<PartyKey, Party>;
  numberByKey: Map<string, string>;
  allTowers: string[];
}

function buildRegistry(): Registry {
  const parties = new Map<PartyKey, Party>();
  const numberByKey = new Map<string, string>();
  let phoneN = 0;
  let imeiN = 0;
  const acctN = { AC: 0, MA: 0, SH: 0 };
  let vehN = 0;

  for (const s of SUSPECTS) {
    const phones: string[] = [];
    const imeis: string[] = [];
    for (let i = 0; i < s.phones; i++) {
      phones.push(synPhone(++phoneN));
      imeis.push(synImei(++imeiN));
    }
    const accounts: string[] = [];
    // First account is always the personal (AC); S6's second is a shell (SH).
    for (let i = 0; i < s.accounts; i++) {
      if (i === 0) accounts.push(synAccount(++acctN.AC, "AC"));
      else accounts.push(synAccount(++acctN.SH, "SH"));
    }
    const vehicles: string[] = [];
    for (let i = 0; i < s.vehicles; i++) vehicles.push(synVehicle(++vehN));

    parties.set(s.key, {
      key: s.key,
      name: s.name,
      phones,
      imeis,
      accounts,
      vehicles,
      homeTowers: [...s.homeTowers],
    });
    numberByKey.set(s.key, phones[0] ?? "");
  }

  for (const m of INTERMEDIARIES) {
    const phones: string[] = [];
    const imeis: string[] = [];
    for (let i = 0; i < m.phones; i++) {
      phones.push(synPhone(++phoneN));
      imeis.push(synImei(++imeiN));
    }
    const accounts: string[] = [];
    for (let i = 0; i < m.accounts; i++) accounts.push(synAccount(++acctN.MA, "MA"));
    parties.set(m.key, {
      key: m.key,
      name: m.name,
      phones,
      imeis,
      accounts,
      vehicles: [],
      homeTowers: [...m.homeTowers],
    });
    numberByKey.set(m.key, phones[0] ?? "");
  }

  for (const n of NOISE_NUMBERS) {
    numberByKey.set(n.key, synPhone(++phoneN));
  }

  const allTowers = LOCATIONS.filter((l) => l.locationType === "cell_tower").map(
    (l) => l.key,
  );

  return { parties, numberByKey, allTowers };
}

function requireParty(reg: Registry, key: PartyKey): Party {
  const p = reg.parties.get(key);
  if (!p) throw new Error(`generate: no party "${key}"`);
  return p;
}

function numberOf(reg: Registry, key: string): string {
  const n = reg.numberByKey.get(key);
  if (!n) throw new Error(`generate: no number for "${key}"`);
  return n;
}

function firstAccount(reg: Registry, key: PartyKey): string {
  const acc = requireParty(reg, key).accounts[0];
  if (!acc) throw new Error(`generate: party "${key}" has no account`);
  return acc;
}

/** The account a given mule-chain holder uses for the laundering path. */
function muleAccount(reg: Registry, holder: PartyKey, kind: "AC" | "MA" | "SH"): string {
  const p = requireParty(reg, holder);
  if (kind === "SH") {
    const sh = p.accounts.find((a) => a.startsWith("SYN-SH-"));
    if (!sh) throw new Error(`generate: "${holder}" has no shell account`);
    return sh;
  }
  if (kind === "MA") {
    const ma = p.accounts.find((a) => a.startsWith("SYN-MA-"));
    if (!ma) throw new Error(`generate: "${holder}" has no mule account`);
    return ma;
  }
  return firstAccount(reg, holder);
}

// --- manifest builders ---------------------------------------------------

interface EvidenceItemDraft {
  ref: string;
  sourceKey: string;
  itemType: CorpusManifest["evidenceItems"][number]["itemType"];
  content: Record<string, unknown>;
}

const SOURCES: CorpusManifest["evidenceSources"] = [
  { key: "fir-register", sourceType: "structured_dataset", label: "Operation DarkNet Delhi — FIR register (synthetic)" },
  { key: "subscriber-registry", sourceType: "structured_dataset", label: "Operation DarkNet Delhi — subscriber & asset registry (synthetic)" },
  { key: "cdr-dataset", sourceType: "structured_dataset", label: "Operation DarkNet Delhi — CDR dataset (synthetic)" },
  { key: "financial-ledger", sourceType: "structured_dataset", label: "Operation DarkNet Delhi — financial ledger (synthetic)" },
  { key: "witness-statements", sourceType: "document", label: "Operation DarkNet Delhi — witness statement bundle (synthetic)" },
  { key: "crime-register", sourceType: "structured_dataset", label: "Operation DarkNet Delhi — crime event register (synthetic)" },
];

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

export interface GeneratedCorpus {
  manifest: CorpusManifest;
  groundTruth: CorpusGroundTruth;
}

export function generateCorpusManifest(): CorpusManifest {
  return generateCorpus().manifest;
}

export function generateGroundTruth(): CorpusGroundTruth {
  return generateCorpus().groundTruth;
}

export function generateCorpus(): GeneratedCorpus {
  const prng = makePrng(CORPUS_SEED);
  const reg = buildRegistry();

  const items: EvidenceItemDraft[] = [];
  const communicationEvents: CorpusManifest["communicationEvents"] = [];
  const financialTransactions: CorpusManifest["financialTransactions"] = [];

  const caseStartMs = Date.parse(CASE_START);
  const caseEndMs = Date.parse(CASE_END);
  const randInWindow = (startMs: number, endMs: number): number =>
    startMs + prng.next() * (endMs - startMs);
  const randCaseTime = (): number => randInWindow(caseStartMs, caseEndMs);

  // 1. FIRs -------------------------------------------------------------
  for (const fir of FIRS) {
    const content: Record<string, unknown> = {
      recordRef: `fir:${pad(fir.n, 3)}`,
      firNumber: synFir(fir.n),
      filedAt: fir.filedAt,
      accused: fir.accused.map((k) => requireParty(reg, k as PartyKey).name),
      summary: fir.summary,
    };
    if (fir.n === 3) {
      content.seizedVehicle = { plate: synVehicle(4), colour: "white" };
    }
    items.push({ ref: `fir:${pad(fir.n, 3)}`, sourceKey: "fir-register", itemType: "fir", content });
  }

  // 2. Suspect records + duplicate/ambiguous variants -----------------
  for (const s of SUSPECTS) {
    const p = requireParty(reg, s.key);
    items.push({
      ref: `suspect:${s.key}`,
      sourceKey: "subscriber-registry",
      itemType: "suspect_record",
      content: {
        recordRef: `suspect:${s.key}`,
        name: s.name,
        role: s.role,
        knownAliases: s.aliases,
        phones: p.phones,
        accounts: p.accounts,
        vehicles: p.vehicles,
        residence: s.residence,
      },
    });
  }
  for (const dup of DUPLICATE_MENTIONS) {
    const p = requireParty(reg, dup.entityKey);
    dup.variants.slice(1).forEach((variant, i) => {
      items.push({
        ref: `suspect:${dup.entityKey}:var${i + 1}`,
        sourceKey: "subscriber-registry",
        itemType: "suspect_record",
        content: {
          recordRef: `suspect:${dup.entityKey}:var${i + 1}`,
          name: variant,
          note: "registry spelling variant — same individual",
          linkedPhone: p.phones[0] ?? null,
        },
      });
    });
  }

  // 3. Alias records --------------------------------------------------
  for (const s of SUSPECTS) {
    s.aliases.forEach((alias, i) => {
      items.push({
        ref: `alias:${s.key}:${i}`,
        sourceKey: "subscriber-registry",
        itemType: "alias_record",
        content: { recordRef: `alias:${s.key}:${i}`, primaryName: s.name, alias },
      });
    });
  }

  // 4. Phone + IMEI records -----------------------------------------
  const allParties: PartyKey[] = [
    ...SUSPECTS.map((s) => s.key),
    ...INTERMEDIARIES.map((m) => m.key),
  ];
  for (const key of allParties) {
    const p = requireParty(reg, key);
    p.phones.forEach((number, i) => {
      const imei = p.imeis[i] ?? synImei(0);
      // S3's first subscriber line carries the typo spelling on purpose.
      const subscriberName =
        key === "S3" && i === 0 ? "Kabir Sharman" : p.name;
      items.push({
        ref: `phone:${key}:${i}`,
        sourceKey: "subscriber-registry",
        itemType: "phone_record",
        content: {
          recordRef: `phone:${key}:${i}`,
          number,
          subscriberName,
          imei,
        },
      });
      items.push({
        ref: `imei:${key}:${i}`,
        sourceKey: "subscriber-registry",
        itemType: "imei_record",
        content: { recordRef: `imei:${key}:${i}`, imei, boundNumber: number },
      });
    });
  }

  // 5. Vehicle records (incl. the seized SYN-VEH-0004) ----------------
  const vehicleOwners: { key: PartyKey; plate: string }[] = [];
  for (const key of allParties) {
    for (const plate of requireParty(reg, key).vehicles) {
      vehicleOwners.push({ key, plate });
    }
  }
  vehicleOwners.forEach(({ key, plate }) => {
    items.push({
      ref: `vehicle:${plate}`,
      sourceKey: "subscriber-registry",
      itemType: "vehicle_record",
      content: {
        recordRef: `vehicle:${plate}`,
        plate,
        registeredTo: requireParty(reg, key).name,
        colour: prng.pick(["black", "white", "grey", "blue"]),
      },
    });
  });
  items.push({
    ref: `vehicle:${synVehicle(4)}`,
    sourceKey: "subscriber-registry",
    itemType: "vehicle_record",
    content: {
      recordRef: `vehicle:${synVehicle(4)}`,
      plate: synVehicle(4),
      registeredTo: requireParty(reg, "S2").name,
      colour: "white",
      note: "impounded at crime event C1",
    },
  });

  // 6. Bank account records ----------------------------------------
  for (const key of allParties) {
    for (const account of requireParty(reg, key).accounts) {
      const accountKind = account.startsWith("SYN-SH-")
        ? "shell"
        : account.startsWith("SYN-MA-")
          ? "mule"
          : "personal";
      items.push({
        ref: `account:${account}`,
        sourceKey: "subscriber-registry",
        itemType: "bank_account_record",
        content: {
          recordRef: `account:${account}`,
          account,
          holderName: requireParty(reg, key).name,
          accountKind,
        },
      });
    }
  }

  // 7. Location records + structured locations ---------------------
  const locations: CorpusManifest["locations"] = LOCATIONS.map((loc) => {
    items.push({
      ref: `location:${loc.key}`,
      sourceKey: "subscriber-registry",
      itemType: "location_record",
      content: {
        recordRef: `location:${loc.key}`,
        label: loc.label,
        locationType: loc.locationType,
        latitude: loc.latitude,
        longitude: loc.longitude,
      },
    });
    return {
      ref: `location:${loc.key}`,
      sourceRef: `location:${loc.key}`,
      label: loc.label,
      locationType: loc.locationType,
      latitude: loc.latitude,
      longitude: loc.longitude,
    };
  });
  const towerRefByKey = new Map(
    LOCATIONS.filter((l) => l.locationType === "cell_tower").map((l) => [
      l.key,
      `location:${l.key}`,
    ]),
  );

  // 8. CDR events ------------------------------------------------
  interface CallDraft {
    caller: string;
    callee: string;
    startedAt: string;
    durationSeconds: number;
    tower: string;
  }
  const calls: CallDraft[] = [];

  const towersFor = (key: PartyKey): string[] => {
    const p = reg.parties.get(key);
    return p && p.homeTowers.length > 0 ? p.homeTowers : reg.allTowers;
  };
  const intensityBase: Record<string, number> = { high: 55, medium: 38, low: 22 };

  for (const pair of COMM_PAIRS) {
    const aNum = numberOf(reg, pair.a);
    const bNum = numberOf(reg, pair.b);
    const n = prng.around(intensityBase[pair.intensity] ?? 24, 10, 8);
    const towerPool = [
      ...new Set([...towersFor(pair.a), ...towersFor(pair.b)]),
    ];
    for (let i = 0; i < n; i++) {
      const flip = prng.chance(0.5);
      calls.push({
        caller: flip ? bNum : aNum,
        callee: flip ? aNum : bNum,
        startedAt: isoAt(randCaseTime()),
        durationSeconds: prng.int(15, 1800),
        tower: prng.pick(towerPool),
      });
    }
  }

  // Inject the designed temporal correlations.
  const s1Phone2 = requireParty(reg, "S1").phones[1] ?? numberOf(reg, "S1");
  for (const tc of TEMPORAL_CORRELATIONS) {
    const wStart = Date.parse(tc.windowStart);
    const wEnd = Date.parse(tc.windowEnd);
    const towerRef = tc.cellTower;
    if (tc.key === "TC-hidden-S1-S4") {
      // Co-active on the same tower, WITHOUT calling each other.
      for (let i = 0; i < 2; i++) {
        calls.push({
          caller: s1Phone2,
          callee: numberOf(reg, "M1"),
          startedAt: isoAt(randInWindow(wStart, wEnd)),
          durationSeconds: prng.int(30, 240),
          tower: towerRef,
        });
        calls.push({
          caller: numberOf(reg, "S4"),
          callee: numberOf(reg, "M3"),
          startedAt: isoAt(randInWindow(wStart, wEnd)),
          durationSeconds: prng.int(30, 240),
          tower: towerRef,
        });
      }
    } else if (tc.key === "TC-S3-S7-via-X1") {
      const x1 = numberOf(reg, "X1");
      for (let day = 0; day < 6; day++) {
        const dayStart = wStart + day * 6 * 24 * MS_PER_HOUR;
        const hour = dayStart + prng.next() * MS_PER_HOUR;
        calls.push({
          caller: numberOf(reg, "S3"),
          callee: x1,
          startedAt: isoAt(hour),
          durationSeconds: prng.int(40, 600),
          tower: towerRef,
        });
        calls.push({
          caller: numberOf(reg, "S7"),
          callee: x1,
          startedAt: isoAt(hour + prng.next() * MS_PER_HOUR),
          durationSeconds: prng.int(40, 600),
          tower: towerRef,
        });
      }
    } else if (tc.key === "TC-S5-C1") {
      for (let i = 0; i < 3; i++) {
        calls.push({
          caller: numberOf(reg, "S5"),
          callee: numberOf(reg, "S2"),
          startedAt: isoAt(randInWindow(wStart, wEnd)),
          durationSeconds: prng.int(20, 300),
          tower: towerRef,
        });
      }
    } else if (tc.key === "TC-S2-S6-handoff") {
      calls.push({
        caller: numberOf(reg, "S2"),
        callee: numberOf(reg, "S6"),
        startedAt: isoAt(randInWindow(wStart, wEnd)),
        durationSeconds: prng.int(60, 400),
        tower: towerRef,
      });
      calls.push({
        caller: numberOf(reg, "S6"),
        callee: numberOf(reg, "S2"),
        startedAt: isoAt(randInWindow(wStart, wEnd)),
        durationSeconds: prng.int(60, 400),
        tower: towerRef,
      });
    }
  }

  // Floor top-up so the CDR count always clears the required minimum.
  const s1p = numberOf(reg, "S1");
  const s2p = numberOf(reg, "S2");
  while (calls.length < GENERATION_TARGETS.cdrs) {
    calls.push({
      caller: s1p,
      callee: s2p,
      startedAt: isoAt(randCaseTime()),
      durationSeconds: prng.int(15, 1200),
      tower: prng.pick(reg.allTowers),
    });
  }

  calls.forEach((c, i) => {
    const ref = `cdr:${pad(i + 1, 6)}`;
    const towerRef = towerRefByKey.get(c.tower) ?? undefined;
    items.push({
      ref,
      sourceKey: "cdr-dataset",
      itemType: "cdr_event",
      content: {
        recordRef: ref,
        callerNumber: c.caller,
        calleeNumber: c.callee,
        startedAt: c.startedAt,
        durationSeconds: c.durationSeconds,
        cellTower: c.tower,
      },
    });
    communicationEvents.push({
      sourceRef: ref,
      callerPhone: c.caller,
      calleePhone: c.callee,
      occurredAt: c.startedAt,
      durationSeconds: c.durationSeconds,
      ...(towerRef ? { cellLocationRef: towerRef } : {}),
    });
  });

  // 9. Financial transactions --------------------------------------
  interface TxnDraft {
    fromAccount: string;
    toAccount: string;
    amount: number;
    occurredAt: string;
    kind: string;
  }
  const txns: TxnDraft[] = [];
  const muleTxnRefs: string[] = [];

  const accountForFlowSide = (
    key: PartyKey,
    kind: string,
    side: "from" | "to",
  ): string => {
    if (kind === "mule") {
      const holder = MULE_PATH.find((h) => h.holder === key);
      if (holder) return muleAccount(reg, key, holder.accountKind);
    }
    // M3 → S4 operational payment lands in S4's personal account.
    if (side === "to" && key === "S6" && kind === "operational") {
      return firstAccount(reg, "S6");
    }
    return firstAccount(reg, key);
  };

  for (const flow of TXN_FLOWS) {
    const from = accountForFlowSide(flow.from, flow.kind, "from");
    const to = accountForFlowSide(flow.to, flow.kind, "to");
    const n = prng.around(flow.count, 4, 3);
    for (let i = 0; i < n; i++) {
      txns.push({
        fromAccount: from,
        toAccount: to,
        amount: prng.int(flow.amountMin, flow.amountMax),
        occurredAt: isoAt(randCaseTime()),
        kind: flow.kind,
      });
    }
  }

  const s3acc = firstAccount(reg, "S3");
  const s1acc = firstAccount(reg, "S1");
  while (txns.length < GENERATION_TARGETS.financialTransactions) {
    txns.push({
      fromAccount: s3acc,
      toAccount: s1acc,
      amount: prng.int(6000, 30000),
      occurredAt: isoAt(randCaseTime()),
      kind: "operational",
    });
  }

  let firstHopTotal = 0;
  const firstHopFrom = muleAccount(reg, "S1", "AC");
  const firstHopTo = muleAccount(reg, "M1", "MA");
  txns.forEach((t, i) => {
    const ref = `txn:${pad(i + 1, 6)}`;
    const txnRef = synTxn(i + 1);
    items.push({
      ref,
      sourceKey: "financial-ledger",
      itemType: "financial_transaction_record",
      content: {
        recordRef: ref,
        txnRef,
        fromAccount: t.fromAccount,
        toAccount: t.toAccount,
        amount: t.amount,
        currency: CORPUS_CURRENCY,
        valueDate: t.occurredAt,
      },
    });
    financialTransactions.push({
      sourceRef: ref,
      amount: t.amount,
      currency: CORPUS_CURRENCY,
      occurredAt: t.occurredAt,
    });
    if (t.kind === "mule") muleTxnRefs.push(txnRef);
    if (t.fromAccount === firstHopFrom && t.toAccount === firstHopTo) {
      firstHopTotal += t.amount;
    }
  });

  // 10. Witness statements ------------------------------------------
  for (const w of WITNESS_STATEMENTS) {
    items.push({
      ref: `witness:${w.key}`,
      sourceKey: "witness-statements",
      itemType: "witness_statement",
      content: {
        recordRef: `witness:${w.key}`,
        statementId: w.key,
        aboutNames: w.about.map((k) =>
          reg.parties.get(k as PartyKey)?.name ?? String(k),
        ),
        text: w.text,
      },
    });
  }

  // 11. Crime events ----------------------------------------------
  for (const ce of CRIME_EVENTS) {
    const scene = LOCATIONS.find((l) => l.key === ce.sceneKey);
    items.push({
      ref: `crime:${ce.key}`,
      sourceKey: "crime-register",
      itemType: "crime_event",
      content: {
        recordRef: `crime:${ce.key}`,
        eventId: ce.key,
        firNumber: synFir(ce.firNumber),
        sceneLabel: scene?.label ?? ce.sceneKey,
        nearestTower: ce.nearestTower,
        occurredAt: ce.occurredAt,
        summary: ce.summary,
      },
    });
  }

  const manifest: CorpusManifest = {
    corpus: {
      name: "operation-darknet-delhi",
      version: CORPUS_VERSION,
      seed: CORPUS_SEED,
      generatedAt: CORPUS_GENERATED_AT,
      description: CORPUS_DESCRIPTION,
    },
    investigation: {
      name: "Operation DarkNet Delhi (synthetic)",
      status: "in_progress",
    },
    evidenceSources: SOURCES,
    evidenceItems: items,
    locations,
    communicationEvents,
    financialTransactions,
  };

  const groundTruth = buildGroundTruth(reg, {
    muleTxnRefs,
    approxTotalRouted: firstHopTotal,
  });

  return { manifest, groundTruth };
}

// --- ground truth ------------------------------------------------------

function buildGroundTruth(
  reg: Registry,
  computed: { muleTxnRefs: string[]; approxTotalRouted: number },
): CorpusGroundTruth {
  const principalSuspects = SUSPECTS.map((s) => {
    const p = requireParty(reg, s.key);
    return {
      key: s.key,
      canonicalName: s.name,
      role: s.role,
      aliases: s.aliases,
      phones: p.phones,
      accounts: p.accounts,
      vehicles: p.vehicles,
    };
  });

  const intermediaries = INTERMEDIARIES.map((m) => {
    const p = requireParty(reg, m.key);
    return {
      key: m.key,
      name: m.name,
      role: m.role,
      phones: p.phones,
      accounts: p.accounts,
    };
  });

  const expectedEntityMerges = [
    ...SUSPECTS.map((s) => {
      const mentions = [
        `subscriber-registry:suspect:${s.key}`,
        ...FIRS.filter((f) => f.accused.includes(s.key)).map(
          (f) => `fir:${String(f.n).padStart(3, "0")}:accused`,
        ),
        ...WITNESS_STATEMENTS.filter((w) => w.about.includes(s.key)).map(
          (w) => `witness:${w.key}`,
        ),
        ...(DUPLICATE_MENTIONS.find((d) => d.entityKey === s.key)?.variants.slice(1) ??
          []).map((_, i) => `subscriber-registry:suspect:${s.key}:var${i + 1}`),
      ];
      return {
        entityKey: s.key,
        canonicalLabel: s.name,
        sourceMentions: mentions,
        aliases: s.aliases,
      };
    }),
    ...INTERMEDIARIES.map((m) => ({
      entityKey: m.key,
      canonicalLabel: m.name,
      sourceMentions: [
        `subscriber-registry:phone:${m.key}:0`,
        ...(requireParty(reg, m.key).accounts.map(
          (a) => `subscriber-registry:account:${a}`,
        )),
        ...WITNESS_STATEMENTS.filter((w) => w.about.includes(m.key)).map(
          (w) => `witness:${w.key}`,
        ),
      ],
      aliases: [] as string[],
    })),
  ];

  const aliasMap = [
    ...SUSPECTS.flatMap((s) =>
      s.aliases.map((alias) => ({
        alias,
        entityKey: s.key,
        ...(alias === "SilkFox"
          ? { note: "Owned by S1; operated by S3 on instruction (see W2 vs W9)." }
          : {}),
      })),
    ),
  ];

  const communicationRelationships = COMM_PAIRS.map((pair) => ({
    sourceKey: String(pair.a),
    targetKey: String(pair.b),
    relationshipType: "communication" as const,
    classification: "observed_fact" as const,
    explicit: true,
    materiality: (pair.noise ? "noise" : "material") as "material" | "noise",
    evidenceRefs: ["cdr-dataset"],
  }));

  const financialRelationships = TXN_FLOWS.map((flow) => ({
    sourceKey: String(flow.from),
    targetKey: String(flow.to),
    relationshipType: "financial" as const,
    classification: "observed_fact" as const,
    explicit: true,
    materiality: (flow.kind === "noise" ? "noise" : "material") as
      | "material"
      | "noise",
    evidenceRefs: ["financial-ledger"],
  }));

  const indirectRelationships = INDIRECT_RELATIONSHIPS.map((ir) => {
    const [a, b] = ir.between;
    return {
      sourceKey: String(a),
      targetKey: String(b),
      relationshipType: "associate" as const,
      classification: "ai_inference" as const,
      explicit: false,
      materiality: "material" as const,
      evidenceRefs: [ir.via],
    };
  });

  const expectedRelationships = [
    ...communicationRelationships,
    ...financialRelationships,
    ...indirectRelationships,
  ];

  const hiddenConnections = [
    {
      between: [...HIDDEN_CONNECTION.between.map(String)] as string[],
      reason: HIDDEN_CONNECTION.reason,
      evidenceChain: [...HIDDEN_CONNECTION.evidenceChain],
      recoverableBy: [...HIDDEN_CONNECTION.recoverableBy],
    },
  ];

  const moneyMulePaths = [
    {
      pathAccounts: MULE_PATH.map((h) => muleAccount(reg, h.holder, h.accountKind)),
      holders: MULE_PATH.map((h) => String(h.holder)),
      approxTotalRouted: computed.approxTotalRouted,
      txnRefs: computed.muleTxnRefs,
    },
  ];

  // For the hidden S1<->S4 link the generator uses S1's SECOND phone
  // (operational insulation); every other correlation uses the primary.
  const correlationPhone = (tcKey: string, partyKey: string): string => {
    if (tcKey === "TC-hidden-S1-S4" && partyKey === "S1") {
      return requireParty(reg, "S1").phones[1] ?? numberOf(reg, "S1");
    }
    return numberOf(reg, partyKey);
  };
  const temporalCorrelations = TEMPORAL_CORRELATIONS.map((tc) => ({
    key: tc.key,
    phones: tc.phones.map((k) => correlationPhone(tc.key, String(k))),
    cellTower: tc.cellTower,
    windowStart: tc.windowStart,
    windowEnd: tc.windowEnd,
    meaning: tc.meaning,
  }));

  const spatialCorrelations = [
    {
      entities: ["S1", "S4"],
      locationKey: "SYN-CT-07",
      at: TEMPORAL_CORRELATIONS[0]?.windowStart ?? "2025-08-14T23:05:00.000Z",
      basis: "S1 phone #2 and S4 phone co-active on SYN-CT-07 (covers CS-02).",
    },
    {
      entities: ["S5"],
      locationKey: "SYN-CT-02",
      at: "2025-07-19T22:05:00.000Z",
      basis: "S5 phone on the tower nearest CS-01 at crime event C1 — corroborates W3.",
    },
    {
      entities: ["S2", "S6"],
      locationKey: "SYN-CT-05",
      at: "2025-08-02T09:30:00.000Z",
      basis: "S2 and S6 co-active near the Kapoor Trading front office (W4).",
    },
  ];

  const contradictions = CONTRADICTIONS.map((c) => ({
    kind: c.kind,
    sources: c.sources,
    subject: c.subject,
    detail: c.detail,
    resolutionForbidden: true as const,
  }));

  const misleadingRelationships = MISLEADING_RELATIONSHIPS.map((mr) => ({
    key: mr.key,
    between: mr.between.map(String),
    type: mr.type,
    detail: mr.detail,
    materiality: "noise" as const,
  }));

  const expectedCommunities = EXPECTED_COMMUNITIES.map((c) => ({
    key: c.key,
    members: c.members.map(String),
  }));

  const expectedSignals = EXPECTED_SIGNALS.map((s) => ({
    entityKey: String(s.entityKey),
    signal: s.signal,
    rationale: s.rationale,
  }));

  const intendedConclusions = [
    "S1 (Rohan Malhotra) is the organising principal and financier; his link to the chemistry side (S4) exists only via the laundering chain and the SYN-CT-07 co-location — there is no direct contact anywhere in the corpus.",
    `The laundering route is ${MULE_PATH.map((h) => muleAccount(reg, h.holder, h.accountKind)).join(" -> ")}, moved in tranches beneath a reporting threshold.`,
    "X1 (Rahul Mehta) is a non-suspect communication intermediary and the sole bridge between the vendor sub-cell (S1/S3/S4) and the courier sub-cell (S2/S5/S7/S8).",
    "W7's alibi for S5 is contradicted by W3 and by S5's CDR on SYN-CT-02 at ~22:05 on 2025-07-19; the contradiction must be reported, not resolved.",
    "S2<->S8 and S5<->S8 low-value transfers, and S4/S7 calls to service numbers, are immaterial noise and must not be weighted as case relationships.",
  ];

  const expectedCopilotAnswers: CorpusGroundTruth["expectedCopilotAnswers"] = [
    { question: 1, expects: "All 8 primary suspects listed with the aliases in aliasMap." },
    {
      question: 2,
      expects:
        "No direct relationship between S3 (Kabir Sharma) and S7 (Imran Sheikh); they are connected only indirectly through X1 (Rahul Mehta), a shared phone contact.",
      boundEntities: DEMO_QUESTION_BINDINGS.q2Pair.map(String),
    },
    {
      question: 3,
      expects:
        "Yes — S1 (Rohan Malhotra) to S6 (Neha Kapoor) via the mule chain SYN-AC-000001 -> SYN-MA-000001 -> SYN-MA-000002 -> SYN-MA-000003 -> SYN-SH-000001.",
      boundEntities: DEMO_QUESTION_BINDINGS.q3Pair.map(String),
    },
    {
      question: 4,
      expects:
        "S5 near CS-01 at crime event C1 (P5 on SYN-CT-02 ~22:05, 2025-07-19); also S1 phone #2 and S4 co-active on SYN-CT-07 near CS-02 at C2 time.",
    },
    {
      question: 5,
      expects:
        "Yes — W3 and W7 give contradictory accounts of S5's whereabouts on 2025-07-19 ~22:00 (warehouse vs. Noida wedding); report the contradiction, do not resolve it.",
    },
    {
      question: 6,
      expects:
        "X1 (Rahul Mehta) has the highest betweenness — the only connector between the vendor and courier sub-cells; S1 has the highest overall reach via intermediaries.",
    },
    {
      question: 7,
      expects:
        "Yes — X1 (Rahul Mehta) is linked to more than one principal (S3 and S7) through recurring calls in the CDR data within the same hour on six days.",
      boundEntities: [String(DEMO_QUESTION_BINDINGS.q7Intermediary)],
    },
    {
      question: 8,
      expects:
        "Case summary distinguishing corroborated facts (FIRs, matching CDRs) from AI inferences (the hidden S1-S4 link) and investigative leads (unverified noise relationships).",
    },
  ];

  return {
    corpus: { name: "operation-darknet-delhi", version: CORPUS_VERSION, seed: CORPUS_SEED },
    keyActors: { principalSuspects, intermediaries },
    expectedEntityMerges,
    doNotMerge: DO_NOT_MERGE.map((d) => ({ ...d })),
    aliasMap,
    expectedRelationships,
    hiddenConnections,
    moneyMulePaths,
    temporalCorrelations,
    spatialCorrelations,
    contradictions,
    misleadingRelationships,
    expectedCommunities,
    expectedSignals,
    intendedConclusions,
    expectedCopilotAnswers,
  };
}

/** Exposed for docs/tests: the corpus identity string. */
export const CORPUS_IDENTITY = `${CORPUS_NAME}@${CORPUS_VERSION}#${CORPUS_SEED}`;
