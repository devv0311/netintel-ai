/**
 * Tokens that name a ROLE INSIDE a corporate group rather than the group's
 * brand. One side carrying one that the other lacks is the signature of a
 * parent/subsidiary or holding/operating pair — "Allergan plc" against
 * "Allergan Finance LLC", "Novartis AG" against "Novartis Pharma AG",
 * "Humana AB" against "Humana Holding AB".
 *
 * This is a NAME signal and nothing more. It is derived from the two strings
 * alone, reads no relationship record, and asserts no view about whether a
 * parent and its subsidiary are the same entity — that question is the
 * owner's under P6.21.2 and is untouched here. All this says is that the two
 * names describe different POSITIONS in a group, which is evidence they
 * denote different legal persons, and it can only ever push a pair away from
 * a merge.
 *
 * P6.27 moved it into its own module so the legal-form MINER can veto any
 * candidate containing one of these without importing `features.ts` — which
 * by then imports the vocabulary the miner has not written yet. The set is
 * unchanged; `features.ts` re-exports it so nothing that consumed it there
 * had to move.
 */
export const STRUCTURAL_TOKENS = new Set([
  "holding", "holdings", "group", "groupe", "finance", "financial", "capital",
  "international", "intressenter", "pharma", "pharmaceutical", "pharmaceuticals",
  "services", "solutions", "trust", "partners", "partnership", "ventures",
  "investments", "investment", "management", "operating", "properties",
  "entertainment", "technologies", "systems", "industries", "enterprises",
]);
