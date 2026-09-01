import fs from "node:fs";
import path from "node:path";

import { validateOrThrow } from "@/lib/domain/validation";
import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
import type { Provenance } from "@/lib/domain/provenance";
import { InvestigationSchema, type Investigation } from "@/lib/domain/investigation";
import { EvidenceSourceSchema, EvidenceItemSchema, type EvidenceSource, type EvidenceItem } from "@/lib/domain/evidence";
import { EntitySchema, AliasSchema, type Entity, type Alias } from "@/lib/domain/entity";
import { RelationshipSchema, type Relationship } from "@/lib/domain/relationship";

import { SyntheticFixtureManifestSchema } from "./schema";

/**
 * Loads and validates a synthetic evidence fixture from
 * evidence/synthetic/fixtures/<name>.json, and derives the full set of
 * validated domain objects (with deterministic, application-assigned
 * IDs and complete provenance) that fixture describes.
 *
 * This module never reads from evidence/ground-truth/ — see
 * ./ground-truth-loader.ts and tests/unit/fixtures.test.ts for the
 * isolation boundary this enforces.
 *
 * This does NOT persist anything — it is a pure loader. Callers pass
 * the returned objects to src/lib/db/repository.ts if they want them
 * in the database.
 */

const FIXTURES_DIR = path.join(process.cwd(), "evidence", "synthetic", "fixtures");

export interface LoadedSyntheticFixture {
  investigation: Investigation;
  evidenceSource: EvidenceSource;
  evidenceItems: EvidenceItem[];
  entities: Entity[];
  aliases: Alias[];
  relationships: Relationship[];
}

export function loadSyntheticFixture(name: string): LoadedSyntheticFixture {
  const filePath = path.join(FIXTURES_DIR, `${name}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const manifest = validateOrThrow(
    SyntheticFixtureManifestSchema,
    JSON.parse(raw),
    `loadSyntheticFixture(${name})`,
  );

  const nowIso = new Date().toISOString();
  const fixtureRef = `fixture:${name}`;

  const provenanceFor = (location: string, method: string): Provenance => ({
    source: fixtureRef,
    location,
    method,
    confidence: 1, // fixture data is hand-authored and taken as certain for test purposes
    processingHistory: [`loaded-by-synthetic-loader:${name}`],
    timestamp: nowIso,
  });

  const investigationId = makeOpaqueId("investigation");
  const investigation = validateOrThrow(
    InvestigationSchema,
    {
      id: investigationId,
      name: manifest.investigation.name,
      status: manifest.investigation.status,
      createdAt: nowIso,
    },
    `loadSyntheticFixture(${name}).investigation`,
  );

  const evidenceSourceId = makeContentId("evidence_source", [
    manifest.evidenceSource.sourceType,
    manifest.evidenceSource.label,
  ]);
  const evidenceSource = validateOrThrow(
    EvidenceSourceSchema,
    {
      id: evidenceSourceId,
      investigationId,
      sourceType: manifest.evidenceSource.sourceType,
      label: manifest.evidenceSource.label,
      ingestedAt: nowIso,
    },
    `loadSyntheticFixture(${name}).evidenceSource`,
  );

  const evidenceItems = manifest.evidenceItems.map((item, index) =>
    validateOrThrow(
      EvidenceItemSchema,
      {
        id: makeContentId("evidence_item", [item.itemType, JSON.stringify(item.content)]),
        investigationId,
        evidenceSourceId,
        itemType: item.itemType,
        content: item.content,
        ingestedAt: nowIso,
        validationStatus: "accepted",
        errors: [],
        warnings: [],
        confidence: 1,
      },
      `loadSyntheticFixture(${name}).evidenceItems[${index}]`,
    ),
  );

  const entityIdByLabel = new Map<string, string>();
  const entities = manifest.entities.map((e, index) => {
    const id = makeContentId("entity", [e.kind, e.canonicalLabel]);
    entityIdByLabel.set(e.canonicalLabel, id);
    return validateOrThrow(
      EntitySchema,
      {
        id,
        investigationId,
        kind: e.kind,
        canonicalLabel: e.canonicalLabel,
        attributes: e.attributes,
        provenance: provenanceFor(`entities[${index}]`, "fixture-loader"),
      },
      `loadSyntheticFixture(${name}).entities[${index}]`,
    );
  });

  const aliases = manifest.aliases.map((a, index) => {
    const entityId = entityIdByLabel.get(a.entityLabel);
    if (!entityId) {
      throw new Error(
        `loadSyntheticFixture(${name}).aliases[${index}]: no entity with canonicalLabel "${a.entityLabel}"`,
      );
    }
    return validateOrThrow(
      AliasSchema,
      {
        id: makeContentId("alias", [entityId, a.aliasValue]),
        entityId,
        aliasValue: a.aliasValue,
        provenance: provenanceFor(`aliases[${index}]`, "fixture-loader"),
      },
      `loadSyntheticFixture(${name}).aliases[${index}]`,
    );
  });

  const relationships = manifest.relationships.map((r, index) => {
    const sourceEntityId = entityIdByLabel.get(r.sourceEntityLabel);
    const targetEntityId = entityIdByLabel.get(r.targetEntityLabel);
    if (!sourceEntityId || !targetEntityId) {
      throw new Error(
        `loadSyntheticFixture(${name}).relationships[${index}]: unknown entity label(s)`,
      );
    }
    return validateOrThrow(
      RelationshipSchema,
      {
        id: makeContentId("relationship", [sourceEntityId, targetEntityId, r.relationshipType]),
        investigationId,
        sourceEntityId,
        targetEntityId,
        relationshipType: r.relationshipType,
        classification: r.classification,
        provenance: provenanceFor(`relationships[${index}]`, "fixture-loader"),
      },
      `loadSyntheticFixture(${name}).relationships[${index}]`,
    );
  });

  return { investigation, evidenceSource, evidenceItems, entities, aliases, relationships };
}
