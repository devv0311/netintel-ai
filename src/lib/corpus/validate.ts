import { GEO_BBOX, REQUIRED_VOLUMES, CORPUS_SEED, CORPUS_VERSION } from "./config";
import {
  EXPECTED_SYNTHETIC_PATTERNS,
  FORBIDDEN_REAL_PATTERNS,
} from "./synthetic-identifiers";
import type { CorpusGroundTruth, CorpusManifest } from "./manifest-schema";

/**
 * Deterministic structural validation of the corpus + ground truth.
 *
 * Every check maps to a required property from
 * docs/data/synthetic-investigation-spec.md §3/§4 and the P5.1 brief. It
 * reads only the two artifacts (no filesystem, no clock, no PRNG) so its
 * result is a pure function of its inputs. tests/unit/corpus.test.ts
 * turns each check into an assertion; scripts/generate-corpus.ts prints
 * the report after regenerating.
 */

export interface CorpusCheck {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
}

export interface CorpusValidationReport {
  ok: boolean;
  checks: CorpusCheck[];
}

function itemsOfType(manifest: CorpusManifest, type: string) {
  return manifest.evidenceItems.filter((i) => i.itemType === type);
}

function contentString(value: unknown): string {
  return JSON.stringify(value);
}

export function validateCorpus(
  manifest: CorpusManifest,
  groundTruth: CorpusGroundTruth,
): CorpusValidationReport {
  const checks: CorpusCheck[] = [];
  const add = (id: string, name: string, ok: boolean, detail: string) =>
    checks.push({ id, name, ok, detail });

  const firs = itemsOfType(manifest, "fir");
  add(
    "volume.firs",
    "exactly 5 FIRs",
    firs.length === REQUIRED_VOLUMES.firs,
    `found ${firs.length}`,
  );

  const suspectRecords = itemsOfType(manifest, "suspect_record").filter(
    (i) => typeof i.content.role === "string",
  );
  add(
    "volume.suspects",
    "at least 8 primary suspects",
    suspectRecords.length >= REQUIRED_VOLUMES.primarySuspects,
    `found ${suspectRecords.length} canonical suspect records`,
  );

  const cdrItems = itemsOfType(manifest, "cdr_event");
  add(
    "volume.cdrs",
    "at least 1,000 CDRs",
    cdrItems.length >= REQUIRED_VOLUMES.cdrs &&
      manifest.communicationEvents.length >= REQUIRED_VOLUMES.cdrs,
    `${cdrItems.length} cdr_event items, ${manifest.communicationEvents.length} communication events`,
  );

  const txnItems = itemsOfType(manifest, "financial_transaction_record");
  add(
    "volume.transactions",
    "at least 500 financial transactions",
    txnItems.length >= REQUIRED_VOLUMES.financialTransactions &&
      manifest.financialTransactions.length >= REQUIRED_VOLUMES.financialTransactions,
    `${txnItems.length} transaction items, ${manifest.financialTransactions.length} structured transactions`,
  );

  const aliasItems = itemsOfType(manifest, "alias_record");
  const suspectWithAliases = suspectRecords.filter(
    (i) => Array.isArray(i.content.knownAliases) && i.content.knownAliases.length > 0,
  );
  add(
    "structural.aliases",
    "aliases are present",
    aliasItems.length > 0 && suspectWithAliases.length > 0,
    `${aliasItems.length} alias records; ${suspectWithAliases.length} suspects carry knownAliases`,
  );

  const mergesWithMultipleMentions = groundTruth.expectedEntityMerges.filter(
    (m) => m.sourceMentions.length >= 2,
  );
  const variantRecords = itemsOfType(manifest, "suspect_record").filter(
    (i) => typeof i.content.note === "string" && /variant/i.test(String(i.content.note)),
  );
  add(
    "structural.duplicates",
    "duplicate / ambiguous identity cases are present",
    mergesWithMultipleMentions.length >= 1 &&
      groundTruth.doNotMerge.length >= 1 &&
      variantRecords.length >= 1,
    `${mergesWithMultipleMentions.length} multi-mention merges, ${groundTruth.doNotMerge.length} do-not-merge pairs, ${variantRecords.length} variant spelling records`,
  );

  const evidenceRefs = new Set(manifest.evidenceItems.map((i) => i.ref));
  const contradictionSourcesResolve = groundTruth.contradictions.every(
    (c) => c.sources.length >= 2 && c.sources.every((s) => evidenceRefs.has(s)),
  );
  add(
    "structural.contradictions",
    "contradiction cases are present",
    groundTruth.contradictions.length >= 3 && contradictionSourcesResolve,
    `${groundTruth.contradictions.length} contradictions; all sources resolve to evidence items: ${contradictionSourcesResolve}`,
  );

  const indirect = groundTruth.expectedRelationships.filter((r) => r.explicit === false);
  add(
    "structural.indirect",
    "indirect relationships are present",
    indirect.length >= 1,
    `${indirect.length} non-explicit relationships`,
  );

  const x1 = groundTruth.keyActors.intermediaries.find((m) => m.key === "X1");
  const x1Number = x1?.phones[0];
  const x1Counterparties = new Set<string>();
  if (x1Number) {
    for (const ce of manifest.communicationEvents) {
      if (ce.callerPhone === x1Number) x1Counterparties.add(ce.calleePhone);
      if (ce.calleePhone === x1Number) x1Counterparties.add(ce.callerPhone);
    }
  }
  add(
    "structural.intermediary",
    "intermediary actors are present",
    groundTruth.keyActors.intermediaries.length >= 1 && x1Counterparties.size >= 2,
    `${groundTruth.keyActors.intermediaries.length} intermediaries; X1 has ${x1Counterparties.size} distinct call counterparties`,
  );

  const mulePath = groundTruth.moneyMulePaths[0];
  let muleReconstructable = false;
  if (mulePath && mulePath.pathAccounts.length >= 3) {
    muleReconstructable = true;
    for (let k = 0; k < mulePath.pathAccounts.length - 1; k++) {
      const from = mulePath.pathAccounts[k];
      const to = mulePath.pathAccounts[k + 1];
      const hopExists = txnItems.some(
        (i) => i.content.fromAccount === from && i.content.toAccount === to,
      );
      if (!hopExists) muleReconstructable = false;
    }
  }
  add(
    "structural.moneyMule",
    "money-mule pattern is present",
    Boolean(mulePath) && muleReconstructable,
    mulePath
      ? `path ${mulePath.pathAccounts.join(" -> ")} reconstructable: ${muleReconstructable}`
      : "no mule path in ground truth",
  );

  const lowValueTxns = txnItems.filter(
    (i) => typeof i.content.amount === "number" && (i.content.amount as number) <= 1000,
  );
  const lowValueUnlabelled = lowValueTxns.every(
    (i) => !/noise|misleading|immaterial|irrelevant/i.test(contentString(i.content)),
  );
  add(
    "structural.misleading",
    "misleading low-value relationships are present",
    groundTruth.misleadingRelationships.length >= 1 &&
      lowValueTxns.length >= 1 &&
      lowValueUnlabelled,
    `${groundTruth.misleadingRelationships.length} noise relationships in GT; ${lowValueTxns.length} low-value transactions, none self-labelled`,
  );

  const hiddenTc = groundTruth.temporalCorrelations.find((t) =>
    /hidden/i.test(t.key),
  );
  let hiddenTcRealised = false;
  if (hiddenTc) {
    const wStart = Date.parse(hiddenTc.windowStart);
    const wEnd = Date.parse(hiddenTc.windowEnd);
    const towerRef = `location:${hiddenTc.cellTower}`;
    const onTower = manifest.communicationEvents.filter((ce) => {
      const t = Date.parse(ce.occurredAt);
      return ce.cellLocationRef === towerRef && t >= wStart && t <= wEnd;
    });
    const phonesSeen = new Set<string>();
    for (const ce of onTower) {
      phonesSeen.add(ce.callerPhone);
      phonesSeen.add(ce.calleePhone);
    }
    hiddenTcRealised = hiddenTc.phones.every((p) => phonesSeen.has(p));
  }
  add(
    "structural.temporal",
    "temporal correlations are present",
    groundTruth.temporalCorrelations.length >= 1 && hiddenTcRealised,
    `${groundTruth.temporalCorrelations.length} temporal correlations; hidden-link window realised in CDRs: ${hiddenTcRealised}`,
  );

  const inBox = manifest.locations.every(
    (l) =>
      l.latitude >= GEO_BBOX.minLat &&
      l.latitude <= GEO_BBOX.maxLat &&
      l.longitude >= GEO_BBOX.minLng &&
      l.longitude <= GEO_BBOX.maxLng,
  );
  const towers = manifest.locations.filter((l) => l.locationType === "cell_tower");
  const scenes = manifest.locations.filter((l) => l.locationType === "crime_scene");
  const cdrsWithTower = manifest.communicationEvents.filter((c) => c.cellLocationRef);
  add(
    "structural.spatial",
    "spatial data required by the specification is present",
    manifest.locations.length >= 8 &&
      inBox &&
      towers.length >= 1 &&
      scenes.length >= 1 &&
      cdrsWithTower.length > 0,
    `${manifest.locations.length} locations (${towers.length} towers, ${scenes.length} crime scenes); ${cdrsWithTower.length} CDRs carry a cell location; all in bbox: ${inBox}`,
  );

  // Synthetic-safety sweep.
  const allContent = manifest.evidenceItems.map((i) => contentString(i.content)).join("\n");
  const forbiddenHit = FORBIDDEN_REAL_PATTERNS.find((p) => p.re.test(allContent));
  add(
    "safety.noRealPatterns",
    "no real-looking identifier patterns appear in evidence content",
    !forbiddenHit,
    forbiddenHit ? `matched forbidden pattern: ${forbiddenHit.name}` : "clean",
  );

  const phonePattern = EXPECTED_SYNTHETIC_PATTERNS.find((p) => p.name === "phone");
  const allPhonesSynthetic =
    !!phonePattern &&
    manifest.communicationEvents.every(
      (ce) => phonePattern.re.test(ce.callerPhone) && phonePattern.re.test(ce.calleePhone),
    );
  add(
    "safety.syntheticPhones",
    "every phone number is a synthetic (+99) number",
    allPhonesSynthetic,
    allPhonesSynthetic ? "all CDR numbers match +99 pattern" : "non-synthetic phone found",
  );

  add(
    "meta.version",
    "corpus metadata matches the configured version and seed",
    manifest.corpus.version === CORPUS_VERSION && manifest.corpus.seed === CORPUS_SEED,
    `version ${manifest.corpus.version}, seed ${manifest.corpus.seed}`,
  );

  return { ok: checks.every((c) => c.ok), checks };
}
