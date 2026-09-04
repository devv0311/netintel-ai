import { z } from "zod";

/**
 * `public_record` — the single evidence type through which legitimately
 * obtainable public register data enters the pipeline.
 *
 * One type, not four. `registry_record`, `filing` and `document_record`
 * would each need their own extractor, tests, graph mapping and place in
 * the evidence-classification rules — four times the surface for the same
 * information. `registry` is a free-text field inside one type instead, so
 * a new publisher is data rather than a schema change. A genuinely
 * different STRUCTURE (a long-form filing needing free-text extraction)
 * would earn its own type then, on evidence.
 *
 * Every other evidence type in this project describes data an authorised
 * investigator receives, where licence and retrieval are someone else's
 * problem. This one describes data WE fetched from a publisher, so the
 * fields that make that defensible — `license`, `licenseUrl`, `sourceUrl`,
 * `retrievedAt`, `registry` — are REQUIRED, not optional. A public record
 * that cannot say where it came from and under what terms is rejected at
 * the schema boundary and never reaches extraction. That is the point of
 * the type: it makes provenance and licensing unforgeable rather than
 * conventional.
 *
 * `subjectKind` is limited to person and organisation. Places are
 * deliberately excluded: locations live in their own table, populated at
 * ingestion from the corpus manifest, and routing them through this type
 * would mean two id-minting paths for the same real-world tower or
 * address. Deferred until something needs it.
 */

export const PUBLIC_RECORD_SUBJECT_KINDS = ["person", "organisation"] as const;
export const PublicRecordSubjectKindSchema = z.enum(PUBLIC_RECORD_SUBJECT_KINDS);
export type PublicRecordSubjectKind = z.infer<typeof PublicRecordSubjectKindSchema>;

/** An identifier the publisher issues or records for the subject. */
export const PublicRecordIdentifierSchema = z.object({
  /** Identifier scheme, e.g. "LEI", "WIKIDATA", "ISIN". */
  scheme: z.string().min(1),
  value: z.string().min(1),
});

/** A relation the publisher states between this subject and another of its records. */
export const PublicRecordRelationSchema = z.object({
  /** The publisher's own predicate, normalised by the adapter, e.g. "parent_of". */
  predicate: z.string().min(1),
  /** The publisher's id for the other end — never a NetIntel entity id. */
  targetRegistryRecordId: z.string().min(1),
});

export const PublicRecordContentSchema = z
  .object({
    /** `<registry>:<registryRecordId>`, matching every other evidence type's recordRef convention. */
    recordRef: z.string().min(1),

    // --- what this record is ---
    /** Publisher key, e.g. "gleif", "wikidata". Data, not an enum. */
    registry: z.string().min(1),
    /** The publisher's own identifier for this record. */
    registryRecordId: z.string().min(1),
    subjectKind: PublicRecordSubjectKindSchema,
    /** The publisher's primary name for the subject, verbatim. */
    name: z.string().min(1),
    /**
     * A LEGAL name the publisher states for this subject, distinct from
     * the label it displays and from a trading alias.
     *
     * Added in P6.19 because Wikidata publishes `P1448` "official name"
     * and the adapter never asked for it, which P6.18 measured as the
     * single largest recoverable class of real cross-source failures
     * (`LenDenClub` / `INNOFIN SOLUTIONS PRIVATE LIMITED`).
     *
     * It is NOT an alias. An alias is any other name a subject goes by,
     * including a trading name shared with a sibling company; an official
     * name is the publisher's claim about the registered legal name. They
     * carry different weight as evidence and P6.17.4 recommended aliases
     * NOT be enabled as merge evidence, so conflating the two would
     * silently decide a question that is still open.
     *
     * Carried and provenanced; read by NO resolution tier. Enabling it is
     * a separate, owner-approved change.
     */
    officialName: z.string().min(1).optional(),
    aliases: z.array(z.string().min(1)).optional(),
    identifiers: z.array(PublicRecordIdentifierSchema).optional(),
    relations: z.array(PublicRecordRelationSchema).optional(),
    /** The publisher's own as-of date for the record's content. */
    observedAt: z.string().datetime().optional(),

    /**
     * The jurisdiction the publisher records for the subject, verbatim
     * (GLEIF emits ISO 3166-1 alpha-2, sometimes with a subdivision:
     * "IN", "US-DE"). Free text rather than an enum, because a second
     * publisher will spell it differently and normalising here would
     * destroy what the source actually said.
     */
    jurisdiction: z.string().min(1).optional(),
    /**
     * The subject's status AS THE PUBLISHER STATES IT ("ACTIVE",
     * "LAPSED"). Optional because not every register publishes one, and
     * deliberately not interpreted: nothing downstream treats a value
     * here as a claim that the entity does or does not exist.
     */
    status: z.string().min(1).optional(),

    // --- mandatory provenance and licensing ---
    /** When we fetched it. Not when the publisher wrote it. */
    retrievedAt: z.string().datetime(),
    /** SPDX identifier where one exists, e.g. "CC0-1.0". */
    license: z.string().min(1),
    licenseUrl: z.string().url(),
    /** The exact endpoint or file the record came from. */
    sourceUrl: z.string().url(),
  })
  .strict()
  .refine((record) => record.recordRef === `${record.registry}:${record.registryRecordId}`, {
    message: "recordRef must be `${registry}:${registryRecordId}`",
    path: ["recordRef"],
  });

export type PublicRecordContent = z.infer<typeof PublicRecordContentSchema>;

/** Thrown when a public_record reaches extraction without valid mandatory metadata. */
export class InvalidPublicRecordError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`public_record content is invalid: ${issues.join("; ")}`);
    this.name = "InvalidPublicRecordError";
    this.issues = issues;
  }
}

/** Parses content as a public record, or throws with every issue listed. */
export function parsePublicRecord(content: Record<string, unknown>): PublicRecordContent {
  const result = PublicRecordContentSchema.safeParse(content);
  if (result.success) return result.data;
  throw new InvalidPublicRecordError(
    result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  );
}
