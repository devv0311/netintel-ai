import type { CopilotIntent, GroundedMention, QuestionGrounding } from "./types";

/**
 * Entity/alias-aware question grounding.
 *
 * A pure module: it takes the resolved entities and aliases the
 * repository already holds and turns an investigator's natural-language
 * question into (a) an intent and (b) a set of grounded entity
 * references. It never calls a model, never touches the database, and
 * never invents an entity — a surface that matches nothing stays an
 * `unknownReference`, and a surface that matches more than one entity
 * stays AMBIGUOUS rather than being silently resolved to the first
 * candidate (docs/requirements.md §5: "ambiguous mentions are surfaced,
 * not silently guessed").
 *
 * Surfaces indexed per entity:
 *   - its canonical label ("Rohan Malhotra", "+99 70 000 0001")
 *   - every alias value the resolution stage recorded ("Bhai", "SilkFox")
 *   - a punctuation-free compact form of an identifier label
 *     ("SYN-AC-000001" → "synac000001")
 *   - the trailing numeric group of an identifier ("SYN-AC-000001" →
 *     "000001"), because investigators routinely refer to an account or
 *     a handset by its tail — a shorthand that is genuinely ambiguous
 *     here and must be reported as such
 *   - each distinctive name token of a person label ("Malhotra")
 *
 * Longest surface wins, and a matched span is consumed so a shorter
 * surface inside it cannot double-match.
 */

export interface GroundingIndexEntity {
  id: string;
  kind: string;
  canonicalLabel: string;
}

export interface GroundingIndexAlias {
  entityId: string;
  aliasValue: string;
}

interface SurfaceCandidate {
  entityId: string;
  label: string;
  kind: string;
  matchedOn: string;
}

export interface GroundingIndex {
  /** Normalized surface → the distinct entities it can refer to. */
  surfaces: Map<string, SurfaceCandidate[]>;
  entityById: Map<string, GroundingIndexEntity>;
}

/** Name tokens too generic to index on their own. */
const TOKEN_STOPWORDS = new Set([
  "synthetic",
  "fictional",
  "crime",
  "scene",
  "cell",
  "tower",
  "sector",
  "grid",
  "residence",
  "address",
  "unknown",
  "person",
  "phone",
  "account",
  "vehicle",
]);

const IDENTIFIER_KINDS = new Set(["phone", "imei", "vehicle", "bank_account"]);

/** Lowercase, collapse whitespace, normalize unicode quotes/dashes. */
export function normalizeQuestion(question: string): string {
  return question
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normSurface(value: string): string {
  return normalizeQuestion(value).toLowerCase();
}

function compactForm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** "SYN-AC-000001" → "000001"; "+99 70 000 0001" → "0001". */
function identifierTail(value: string): string | null {
  const groups = value.match(/[0-9]{3,}/g);
  if (!groups || groups.length === 0) return null;
  const tail = groups[groups.length - 1] as string;
  return tail.length >= 3 ? tail : null;
}

function addSurface(index: GroundingIndex, surface: string, candidate: SurfaceCandidate): void {
  const key = normSurface(surface);
  if (key.length < 3) return;
  const existing = index.surfaces.get(key);
  if (!existing) {
    index.surfaces.set(key, [candidate]);
    return;
  }
  if (!existing.some((c) => c.entityId === candidate.entityId)) existing.push(candidate);
}

/**
 * `locations` are indexed alongside entities because a case location is
 * a graph node an investigator will name ("the Karol Bagh warehouse").
 * Recognising them keeps a real place from being reported as an unknown
 * reference; retrieval filters them back out wherever a claim needs a
 * resolved *entity* specifically.
 */
export function buildGroundingIndex(
  entities: readonly GroundingIndexEntity[],
  aliases: readonly GroundingIndexAlias[],
  locations: readonly { id: string; label: string }[] = [],
): GroundingIndex {
  const index: GroundingIndex = { surfaces: new Map(), entityById: new Map() };
  for (const e of entities) index.entityById.set(e.id, e);

  for (const e of entities) {
    const base: SurfaceCandidate = { entityId: e.id, label: e.canonicalLabel, kind: e.kind, matchedOn: e.canonicalLabel };
    addSurface(index, e.canonicalLabel, base);

    const compact = compactForm(e.canonicalLabel);
    if (compact !== normSurface(e.canonicalLabel)) addSurface(index, compact, base);

    if (IDENTIFIER_KINDS.has(e.kind)) {
      const tail = identifierTail(e.canonicalLabel);
      if (tail) addSurface(index, tail, { ...base, matchedOn: `${e.canonicalLabel} (identifier tail “${tail}”)` });
    }

    if (e.kind === "person") {
      for (const token of normSurface(e.canonicalLabel).split(" ")) {
        if (token.length >= 4 && !TOKEN_STOPWORDS.has(token)) {
          addSurface(index, token, { ...base, matchedOn: `${e.canonicalLabel} (name token “${token}”)` });
        }
      }
    }
  }

  for (const a of aliases) {
    const entity = index.entityById.get(a.entityId);
    if (!entity) continue;
    addSurface(index, a.aliasValue, {
      entityId: entity.id,
      label: entity.canonicalLabel,
      kind: entity.kind,
      matchedOn: `alias “${a.aliasValue}”`,
    });
    const compact = compactForm(a.aliasValue);
    if (compact.length >= 4 && compact !== normSurface(a.aliasValue)) {
      addSurface(index, compact, {
        entityId: entity.id,
        label: entity.canonicalLabel,
        kind: entity.kind,
        matchedOn: `alias “${a.aliasValue}”`,
      });
    }
  }

  for (const l of locations) {
    const candidate: SurfaceCandidate = { entityId: l.id, label: l.label, kind: "location", matchedOn: l.label };
    index.entityById.set(l.id, { id: l.id, kind: "location", canonicalLabel: l.label });
    addSurface(index, l.label, candidate);
    // Case locations are labelled verbosely ("Fictional crime scene —
    // Karol Bagh warehouse (synthetic)"); index the distinctive inner
    // phrase too, so an investigator can name the place the way they
    // would say it.
    const inner = l.label.replace(/^[^—]*—\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (inner.length >= 4 && inner !== l.label) addSurface(index, inner, { ...candidate, matchedOn: `${l.label} (site name “${inner}”)` });
  }

  return index;
}

const INTENT_RULES: { intent: CopilotIntent; patterns: RegExp[] }[] = [
  {
    intent: "contradictions",
    patterns: [/contradict/i, /\bconflict(ing|s)?\b/i, /inconsistenc/i, /disagree/i, /cannot both be true/i],
  },
  {
    intent: "financial_path",
    patterns: [
      /financial connection/i,
      /\bmoney\b/i,
      /\bfunds?\b/i,
      /transaction path/i,
      /\bpayments?\b/i,
      /\blaunder/i,
      /\bmule\b/i,
      /\btransfers?\b/i,
    ],
  },
  {
    intent: "colocation_at_event",
    patterns: [
      /same location at the same time/i,
      /co-?locat/i,
      /same place/i,
      /\bplaces? (them|him|her|any|the)\b/i,
      /at the (scene|warehouse|farmhouse|guesthouse)/i,
      /phone activity/i,
      /\bcell tower\b/i,
    ],
  },
  {
    intent: "intermediary_links",
    patterns: [
      /intermediar/i,
      /more than one (principal|suspect)/i,
      /connect(ing|s)? .* (to|and) .* (suspects|principals)/i,
      /\bmiddleman\b/i,
      /\bbroker\b/i,
    ],
  },
  {
    intent: "structural_significance",
    patterns: [
      /most (significant|important|central|connected)/i,
      /structural role/i,
      /\bcentrality\b/i,
      /\bhub\b/i,
      /key player/i,
      /\bbridge\b/i,
      /\bcommunit(y|ies)\b/i,
    ],
  },
  {
    intent: "suspects_overview",
    patterns: [/who are the (primary |main )?suspects/i, /list the suspects/i, /\bwhat aliases\b/i, /\baliases do\b/i],
  },
  {
    intent: "case_summary",
    patterns: [/summari[sz]e the case/i, /case summary/i, /what has been corroborated/i, /overall picture/i],
  },
  {
    intent: "relationship_between",
    patterns: [
      /relationship(s)? (exist|between)/i,
      /how (are|is) .* (related|connected|linked)/i,
      /connection between/i,
      /link(ed)? between/i,
      /\bbetween\b/i,
    ],
  },
];

/** Deterministic, keyword-driven intent classification. No model is involved. */
export function classifyIntent(normalizedQuestion: string, mentionCount: number): CopilotIntent {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(normalizedQuestion))) return rule.intent;
  }
  if (mentionCount > 0) return "entity_profile";
  return "open_question";
}

/** True when position `i` in `haystack` starts/ends on a word boundary for `needle`. */
function isWholeMatch(haystack: string, needle: string, i: number): boolean {
  const before = i === 0 ? "" : haystack[i - 1];
  const afterIndex = i + needle.length;
  const after = afterIndex >= haystack.length ? "" : haystack[afterIndex];
  const isWordChar = (c: string | undefined) => c !== undefined && c !== "" && /[a-z0-9]/.test(c);
  const needleStartsWord = /[a-z0-9]/.test(needle[0] as string);
  const needleEndsWord = /[a-z0-9]/.test(needle[needle.length - 1] as string);
  if (needleStartsWord && isWordChar(before)) return false;
  if (needleEndsWord && isWordChar(after)) return false;
  return true;
}

/** Proper-noun-shaped spans and synthetic identifiers, used to spot references to entities that do not exist. */
const UNKNOWN_REFERENCE_PATTERNS = [
  /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g,
  /\bSYN-[A-Z]+-[0-9]+\b/g,
  /'[^']{2,40}'/g,
  /"[^"]{2,40}"/g,
];

export function groundQuestion(question: string, index: GroundingIndex): QuestionGrounding {
  const normalizedQuestion = normalizeQuestion(question);
  const haystack = normalizedQuestion.toLowerCase();

  // Longest surfaces first so "rohan malhotra" beats "malhotra".
  const surfaces = [...index.surfaces.keys()].sort((a, b) =>
    b.length !== a.length ? b.length - a.length : a < b ? -1 : 1,
  );
  const multiWordSurfaces = surfaces.filter((s) => s.includes(" "));

  const claimed: { start: number; end: number }[] = [];
  const overlaps = (start: number, end: number) => claimed.some((c) => start < c.end && end > c.start);

  // PASS 1 — unknown references, claimed BEFORE anything else.
  //
  // A proper-name or identifier span that this case has no record of
  // must not be partially matched: without this pass, "Priya Sharma"
  // would match the indexed name token "sharma" and the Copilot would
  // answer confidently about an entirely different person. Claiming the
  // span first makes the reference unknown, which is the truthful
  // outcome.
  const unknownReferences: string[] = [];
  const spans: { start: number; end: number; text: string }[] = [];
  for (const pattern of UNKNOWN_REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of normalizedQuestion.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length, text: match[0] });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  for (const span of spans) {
    if (overlaps(span.start, span.end)) continue;
    const cleaned = span.text.replace(/^['"]|['"]$/g, "").trim();
    if (cleaned.length < 3) continue;
    const key = normSurface(cleaned);
    // Known outright, or an inner part of a longer known surface
    // ("Karol Bagh" inside the full crime-scene label), or a span that
    // wraps a known multi-word surface ("Mr Rohan Malhotra") — all of
    // those are left for the normal matching pass below.
    if (index.surfaces.has(key)) continue;
    if (surfaces.some((s) => s.includes(key))) continue;
    if (multiWordSurfaces.some((s) => key.includes(s))) continue;
    claimed.push({ start: span.start, end: span.end });
    if (!unknownReferences.includes(cleaned)) unknownReferences.push(cleaned);
  }

  // PASS 2 — known surfaces, longest first, over everything not claimed.
  const mentions: GroundedMention[] = [];
  for (const surface of surfaces) {
    let from = 0;
    for (;;) {
      const i = haystack.indexOf(surface, from);
      if (i === -1) break;
      from = i + 1;
      if (!isWholeMatch(haystack, surface, i)) continue;
      const end = i + surface.length;
      if (overlaps(i, end)) continue;
      claimed.push({ start: i, end });
      const candidates = (index.surfaces.get(surface) ?? []).slice().sort((a, b) => (a.entityId < b.entityId ? -1 : 1));
      mentions.push({
        surface: normalizedQuestion.slice(i, end),
        offset: i,
        candidates,
        ambiguous: candidates.length > 1,
      });
    }
  }
  mentions.sort((a, b) => a.offset - b.offset);

  const resolvedEntityIds: string[] = [];
  for (const m of mentions) {
    if (!m.ambiguous && m.candidates[0] && !resolvedEntityIds.includes(m.candidates[0].entityId)) {
      resolvedEntityIds.push(m.candidates[0].entityId);
    }
  }

  return {
    question,
    normalizedQuestion,
    intent: classifyIntent(normalizedQuestion, mentions.length),
    mentions,
    resolvedEntityIds,
    unknownReferences,
  };
}
