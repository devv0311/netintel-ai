import fs from "node:fs";
import path from "node:path";

import { validateOrThrow } from "../domain/validation";
import { makeContentId } from "../domain/ids";
import type { Provenance } from "../domain/provenance";
import { InvestigationSchema, type Investigation } from "../domain/investigation";
import {
  EvidenceSourceSchema,
  EvidenceItemSchema,
  type EvidenceSource,
  type EvidenceItem,
} from "../domain/evidence";
import { LocationSchema, type Location } from "../domain/location";
import {
  CommunicationEventSchema,
  FinancialTransactionSchema,
  type CommunicationEvent,
  type FinancialTransaction,
} from "../domain/events";

import { CORPUS_GENERATED_AT } from "./config";
import { canonicalize } from "./canonicalize";
import { CorpusManifestSchema, type CorpusManifest } from "./manifest-schema";

/**
 * Loads and validates the Operation DarkNet Delhi APPLICATION EVIDENCE
 * corpus from evidence/synthetic/<name>.json and derives the full set of
 * validated domain objects — with deterministic, application-assigned
 * IDs (src/lib/domain/ids.ts) and complete provenance — that the pipeline
 * is allowed to process.
 *
 * Boundary guarantees (docs/data/ground-truth-spec.md §2):
 *   - this module NEVER reads evidence/ground-truth/ and never imports
 *     ./ground-truth.ts;
 *   - the returned object contains only raw/observational evidence — no
 *     expected merges, no contradiction answers, no hidden-connection
 *     labels. Those live only in the ground-truth artifact.
 *
 * Like src/lib/fixtures/synthetic-loader.ts this is a PURE loader: it
 * persists nothing. Callers hand the result to ./persist.ts (which uses
 * only src/lib/db/repository.ts) if they want it in the database.
 *
 * Unlike the foundation-smoke loader, every id and timestamp here is
 * deterministic for a given corpus version — the corpus is a fixed
 * versioned dataset (docs/requirements.md §6), so a load is
 * byte-reproducible.
 */

const SYNTHETIC_DIR = path.join(process.cwd(), "evidence", "synthetic");

export interface LoadedCorpus {
  investigation: Investigation;
  evidenceSources: EvidenceSource[];
  evidenceItems: EvidenceItem[];
  locations: Location[];
  communicationEvents: CommunicationEvent[];
  financialTransactions: FinancialTransaction[];
  counts: {
    evidenceSources: number;
    evidenceItems: number;
    locations: number;
    communicationEvents: number;
    financialTransactions: number;
    byItemType: Record<string, number>;
  };
}

export function parseCorpusManifest(raw: unknown, context: string): CorpusManifest {
  return validateOrThrow(CorpusManifestSchema, raw, context);
}

export function loadInvestigationCorpus(name = "operation-darknet-delhi"): LoadedCorpus {
  const filePath = path.join(SYNTHETIC_DIR, `${name}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const manifest = parseCorpusManifest(
    JSON.parse(raw),
    `loadInvestigationCorpus(${name})`,
  );
  return materializeCorpus(manifest, name);
}

/** Shared by the disk loader and the in-memory determinism tests. */
export function materializeCorpus(
  manifest: CorpusManifest,
  name: string = manifest.corpus.name,
): LoadedCorpus {
  const stamp = CORPUS_GENERATED_AT;
  const corpusRef = `corpus:${manifest.corpus.name}@${manifest.corpus.version}`;

  const investigation = validateOrThrow(
    InvestigationSchema,
    {
      id: makeContentId("investigation", [manifest.corpus.name, manifest.corpus.version]),
      name: manifest.investigation.name,
      status: manifest.investigation.status,
      createdAt: stamp,
    },
    `${name}.investigation`,
  );

  const sourceIdByKey = new Map<string, string>();
  const evidenceSources = manifest.evidenceSources.map((s, i) => {
    const id = makeContentId("evidence_source", [s.sourceType, s.label]);
    sourceIdByKey.set(s.key, id);
    return validateOrThrow(
      EvidenceSourceSchema,
      {
        id,
        investigationId: investigation.id,
        sourceType: s.sourceType,
        label: s.label,
        ingestedAt: stamp,
      },
      `${name}.evidenceSources[${i}]`,
    );
  });

  const itemIdByRef = new Map<string, string>();
  const byItemType: Record<string, number> = {};
  const evidenceItems = manifest.evidenceItems.map((item, i) => {
    const sourceId = sourceIdByKey.get(item.sourceKey);
    if (!sourceId) {
      throw new Error(
        `${name}.evidenceItems[${i}]: unknown sourceKey "${item.sourceKey}"`,
      );
    }
    const id = makeContentId("evidence_item", [
      item.itemType,
      canonicalize(item.content),
    ]);
    if (itemIdByRef.has(item.ref)) {
      throw new Error(`${name}.evidenceItems[${i}]: duplicate ref "${item.ref}"`);
    }
    itemIdByRef.set(item.ref, id);
    byItemType[item.itemType] = (byItemType[item.itemType] ?? 0) + 1;
    return validateOrThrow(
      EvidenceItemSchema,
      {
        id,
        investigationId: investigation.id,
        evidenceSourceId: sourceId,
        itemType: item.itemType,
        content: item.content,
        ingestedAt: stamp,
        validationStatus: "accepted",
        errors: [],
        warnings: [],
        confidence: 1,
      },
      `${name}.evidenceItems[${i}]`,
    );
  });

  const provenanceFrom = (sourceRef: string, i: number, kind: string): Provenance => {
    const sourceId = itemIdByRef.get(sourceRef);
    if (!sourceId) {
      throw new Error(`${name}.${kind}[${i}]: unknown sourceRef "${sourceRef}"`);
    }
    return {
      source: sourceId,
      location: sourceRef,
      method: `corpus-projection:${manifest.corpus.version}`,
      confidence: 1,
      processingHistory: [corpusRef, "corpus-load"],
      timestamp: stamp,
    };
  };

  const locationIdByRef = new Map<string, string>();
  const locations = manifest.locations.map((loc, i) => {
    const id = makeContentId("location", [loc.label, loc.locationType]);
    locationIdByRef.set(loc.ref, id);
    return validateOrThrow(
      LocationSchema,
      {
        id,
        investigationId: investigation.id,
        label: loc.label,
        locationType: loc.locationType,
        latitude: loc.latitude,
        longitude: loc.longitude,
        provenance: provenanceFrom(loc.sourceRef, i, "locations"),
      },
      `${name}.locations[${i}]`,
    );
  });

  const communicationEvents = manifest.communicationEvents.map((ce, i) =>
    validateOrThrow(
      CommunicationEventSchema,
      {
        id: makeContentId("communication_event", [
          ce.sourceRef,
          ce.callerPhone,
          ce.calleePhone,
          ce.occurredAt,
        ]),
        investigationId: investigation.id,
        callerPhone: ce.callerPhone,
        calleePhone: ce.calleePhone,
        occurredAt: ce.occurredAt,
        durationSeconds: ce.durationSeconds,
        ...(ce.cellLocationRef
          ? { cellLocationId: locationIdByRef.get(ce.cellLocationRef) }
          : {}),
        provenance: provenanceFrom(ce.sourceRef, i, "communicationEvents"),
      },
      `${name}.communicationEvents[${i}]`,
    ),
  );

  const financialTransactions = manifest.financialTransactions.map((tx, i) =>
    validateOrThrow(
      FinancialTransactionSchema,
      {
        id: makeContentId("financial_transaction", [tx.sourceRef]),
        investigationId: investigation.id,
        amount: tx.amount,
        currency: tx.currency,
        occurredAt: tx.occurredAt,
        provenance: provenanceFrom(tx.sourceRef, i, "financialTransactions"),
      },
      `${name}.financialTransactions[${i}]`,
    ),
  );

  return {
    investigation,
    evidenceSources,
    evidenceItems,
    locations,
    communicationEvents,
    financialTransactions,
    counts: {
      evidenceSources: evidenceSources.length,
      evidenceItems: evidenceItems.length,
      locations: locations.length,
      communicationEvents: communicationEvents.length,
      financialTransactions: financialTransactions.length,
      byItemType,
    },
  };
}
