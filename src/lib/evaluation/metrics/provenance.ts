import { collectProvenanceBearingRows, type SystemSnapshot } from "@/lib/evaluation/snapshot";
import { ratioMetric, type MetricResult } from "@/lib/evaluation/types";

/**
 * The six provenance fields required by docs/requirements.md §8, on
 * every derived row.
 *
 * This is the one metric in the harness whose threshold is not invented:
 * docs/evaluation/evaluation-spec.md already fixes it at 100% and calls
 * it "not a tunable target but a correctness requirement". So it is the
 * only place the evaluator is entitled to say pass or fail.
 */
const REQUIRED_FIELDS = [
  "source",
  "location",
  "method",
  "confidence",
  "processingHistory",
  "timestamp",
] as const;

export function provenanceCompletenessMetric(snapshot: SystemSnapshot): MetricResult {
  const rows = collectProvenanceBearingRows(snapshot);
  const failures: { table: string; id: string; missing: string[] }[] = [];
  const byTable: Record<string, { rows: number; complete: number }> = {};

  for (const row of rows) {
    const bucket = (byTable[row.table] ??= { rows: 0, complete: 0 });
    bucket.rows++;
    const missing: string[] = [];
    const p = row.provenance as unknown as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      const value = p[field];
      if (field === "confidence") {
        if (typeof value !== "number" || !Number.isFinite(value)) missing.push(field);
        continue;
      }
      if (field === "processingHistory") {
        if (!Array.isArray(value) || value.length === 0) missing.push(field);
        continue;
      }
      if (field === "timestamp") {
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) missing.push(field);
        continue;
      }
      if (typeof value !== "string" || value.trim().length === 0) missing.push(field);
    }
    if (missing.length === 0) bucket.complete++;
    else failures.push({ table: row.table, id: row.id, missing });
  }

  return ratioMetric({
    id: "provenance.completeness",
    name: "Provenance completeness",
    category: "Provenance completeness",
    definition:
      "Fraction of persisted derived rows carrying all six provenance fields — source, location, method, confidence, processing history and timestamp — with a usable value in each.",
    numeratorDefinition: "derived rows with all six provenance fields populated",
    denominatorDefinition: "derived rows across extracted_records, entities, aliases, locations, relationships, resolution_decisions, analytical_signals and corroboration_findings",
    numerator: rows.length - failures.length,
    denominator: rows.length,
    groundTruthSource: "none — the requirement itself (docs/requirements.md §8) is the reference",
    systemInput: "every provenance-bearing table in the store",
    threshold: {
      value: 1,
      comparison: "gte",
      source: "docs/evaluation/evaluation-spec.md §2 — 'this is not a tunable target but a correctness requirement'",
    },
    limitations: [
      "Checks presence and basic type/format, not correctness. A row whose provenance.location points at the wrong field still counts as complete.",
      "`processingHistory` must be a non-empty array; an empty history is treated as missing, since a derived row with no recorded processing step cannot be traced.",
      "dossiers rows are excluded: a dossier is an immutable assembly of ids other tables already own, and its own traceability is checked by src/lib/dossier/verify.ts at write time.",
    ],
    details: { rows: rows.length, failures: failures.length, byTable, sampleFailures: failures.slice(0, 10) },
  });
}
