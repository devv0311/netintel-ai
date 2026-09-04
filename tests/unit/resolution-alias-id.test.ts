import { describe, it, expect } from "vitest";

import { makeContentId } from "@/lib/domain/ids";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import { resolveEntities } from "@/lib/resolution/resolve";

/**
 * P6.19: an entity may not emit two alias rows that claim one alias id.
 *
 * `makeContentId` trims and lower-cases its parts, so an alias id is
 * case-insensitive BY DESIGN: `PIONEER RAILCORP` and `Pioneer Railcorp`
 * are one row. The emitter used to key its dedupe map on the raw string,
 * so both survived, and persistence then inserted one id twice and threw
 * `UNIQUE constraint failed: aliases.id` — taking the entire resolution
 * stage down, not just the alias.
 *
 * The 257-record corpus never hit it. GLEIF publishes exactly this pair
 * of `otherNames` for real entities, so the 1,245-record P6.19 corpus
 * did, on its first run.
 *
 * These fixtures use the REAL publisher strings that triggered it.
 */

function record(opts: {
  evidenceItemId: string;
  recordType: ExtractedRecord["recordType"];
  data: Record<string, unknown>;
  fieldPath: string;
}): ExtractedRecord {
  return {
    id: makeContentId("extracted_record", [opts.evidenceItemId, opts.fieldPath]),
    evidenceItemId: opts.evidenceItemId,
    recordType: opts.recordType,
    data: opts.data,
    classification: "observed_fact",
    provenance: {
      source: opts.evidenceItemId,
      location: `fixture:${opts.evidenceItemId}#${opts.fieldPath}`,
      method: "extraction:field-read:fixture",
      confidence: 1,
      processingHistory: [`evidence_item:${opts.evidenceItemId}`, "extraction:fixture"],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  };
}

/** An organisation whose evidence item states publisher aliases, as GLEIF's otherNames do. */
function orgWithAliases(
  evidenceItemId: string,
  name: string,
  aliases: string[],
  lei: string,
): ExtractedRecord[] {
  return [
    record({
      evidenceItemId,
      recordType: "entity_mention",
      fieldPath: "name",
      data: { factType: "organisation_named", mentionKind: "organisation", observedValue: name, registry: "gleif" },
    }),
    record({
      evidenceItemId,
      recordType: "relationship_mention",
      fieldPath: "identifiers[0]",
      data: {
        factType: "subject_has_identifier", relationshipType: "has_identifier",
        subject: name, observedValue: `LEI:${lei}`, scheme: "LEI",
      },
    }),
    ...aliases.map((alias, i) =>
      record({
        evidenceItemId,
        recordType: "relationship_mention",
        fieldPath: `aliases[${i}]`,
        data: { factType: "subject_has_alias", relationshipType: "alias_of", subject: name, observedValue: alias },
      }),
    ),
  ];
}

const resolve = (records: ExtractedRecord[]) =>
  resolveEntities(records, "investigation_alias_id", "2026-01-01T00:00:00.000Z");

describe("alias ids are unique within a resolution run", () => {
  it("collapses two case-variant aliases of one entity into one row", () => {
    const output = resolve(
      orgWithAliases("gleif_pioneer", "Pioneer Railcorp Inc", ["PIONEER RAILCORP", "Pioneer Railcorp"], "549300E3MW3FRQ0U9M24"),
    );
    const ids = output.aliases.map((a) => a.id);
    expect(new Set(ids).size, "two alias rows claimed one deterministic id").toBe(ids.length);
    const pioneer = output.aliases.filter((a) => a.aliasValue.toLowerCase() === "pioneer railcorp");
    expect(pioneer).toHaveLength(1);
    // The publisher's own casing is kept; the winner is the lowest source
    // record id, which is deterministic and not dependent on input order.
    expect(["PIONEER RAILCORP", "Pioneer Railcorp"]).toContain(pioneer[0]!.aliasValue);
  });

  it("is order-independent", () => {
    const a = resolve(orgWithAliases("gleif_monsoon", "Monsoon Accessorize", ["MONSOON ACCESSORIZE LIMITED", "Monsoon Accessorize Limited"], "549300RVXR52VP8G0Q95"));
    const b = resolve(orgWithAliases("gleif_monsoon", "Monsoon Accessorize", ["Monsoon Accessorize Limited", "MONSOON ACCESSORIZE LIMITED"], "549300RVXR52VP8G0Q95"));
    expect(a.aliases.map((x) => x.id).sort()).toEqual(b.aliases.map((x) => x.id).sort());
  });

  it("still keeps aliases that differ by more than case", () => {
    const output = resolve(
      orgWithAliases("gleif_multi", "Example Holdings", ["Example Trading", "EXAMPLE TRADING", "Example Group"], "549300EXAMPLE0000000"),
    );
    const values = output.aliases.map((a) => a.aliasValue.toLowerCase()).sort();
    expect(values).toEqual(["example group", "example trading"]);
    expect(new Set(output.aliases.map((a) => a.id)).size).toBe(output.aliases.length);
  });
});
