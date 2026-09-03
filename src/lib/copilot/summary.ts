import { AI_MODEL_BASELINE } from "@/lib/ai/client";
import type { Entity } from "@/lib/domain/entity";
import { getEnv } from "@/lib/env";

import { COPILOT_SCHEMA_VERSION } from "./contract";
import { loadCopilotSnapshot } from "./load";
import { COPILOT_PROMPT_VERSION } from "./prompt";
import { findMoneyChain, findPath, indexSnapshot, type CorpusSnapshot } from "./retrieval";
import type { CopilotState, CopilotSummary, SuggestedQuestion } from "./types";

/**
 * The server-derived Copilot state the Investigation Workspace renders
 * from, mirroring src/lib/corroboration/summary.ts.
 *
 * The suggested questions are the eight canonical investigative
 * questions the project committed to in docs/demo/demo-contract.md §3.
 * The three that carry entity placeholders are bound HERE, from the
 * persisted graph — the pair with no direct edge but a real path, the
 * longest money chain, the strongest structural bridge — and never from
 * `evidence/ground-truth/`, which stays a held-out answer key
 * (docs/data/ground-truth-spec.md §2).
 */

const FINANCIAL_EDGE_TYPES = new Set(["financial", "ownership"]);

function persons(snapshot: CorpusSnapshot): Entity[] {
  return snapshot.entities
    .filter((e) => e.kind === "person")
    .sort((a, b) => (a.canonicalLabel < b.canonicalLabel ? -1 : a.canonicalLabel > b.canonicalLabel ? 1 : 0));
}

function hasDirectEdge(snapshot: CorpusSnapshot, aId: string, bId: string): boolean {
  return snapshot.relationships.some(
    (r) => (r.sourceEntityId === aId && r.targetEntityId === bId) || (r.sourceEntityId === bId && r.targetEntityId === aId),
  );
}

/** The first person pair (alphabetically) with no direct edge but a real multi-hop route. */
function indirectPair(snapshot: CorpusSnapshot): [Entity, Entity] | null {
  const people = persons(snapshot);
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const a = people[i] as Entity;
      const b = people[j] as Entity;
      if (hasDirectEdge(snapshot, a.id, b.id)) continue;
      const path = findPath(snapshot.relationships, a.id, b.id);
      if (path && path.relationshipIds.length >= 2) return [a, b];
    }
  }
  return null;
}

/**
 * The person pair joined by the longest ACCOUNT-LEVEL transfer chain —
 * the money trail worth asking about. Searched over accounts rather
 * than people because a person-level traversal collapses a mule chain
 * into a single hop and hides exactly what the question is after.
 */
function longestMoneyPair(snapshot: CorpusSnapshot): [Entity, Entity] | null {
  const index = indexSnapshot(snapshot);
  const people = persons(snapshot);
  let best: { pair: [Entity, Entity]; hops: number } | null = null;
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      const a = people[i] as Entity;
      const b = people[j] as Entity;
      const chain = findMoneyChain(snapshot.relationships, index, a.id, b.id);
      const hops = chain?.relationshipIds.length ?? 0;
      if (hops >= 2 && (!best || hops > best.hops)) best = { pair: [a, b], hops };
    }
  }
  return best?.pair ?? null;
}

/** The person whose removal fragments the network most — the structural intermediary. */
function strongestBridgePerson(snapshot: CorpusSnapshot): Entity | null {
  const byId = new Map(snapshot.entities.map((e) => [e.id, e]));
  const candidates = snapshot.analyticalSignals
    .filter((s) => s.signalType === "bridge" && s.targetEntityId && byId.get(s.targetEntityId)?.kind === "person")
    .sort(
      (a, b) =>
        Number(b.value.componentsAfter ?? 0) - Number(a.value.componentsAfter ?? 0) ||
        Number(b.value.bridgeScore ?? 0) - Number(a.value.bridgeScore ?? 0) ||
        (a.id < b.id ? -1 : 1),
    );
  const top = candidates[0];
  return top?.targetEntityId ? (byId.get(top.targetEntityId) ?? null) : null;
}

function firstCrimeSceneLabel(snapshot: CorpusSnapshot): string | null {
  const event = snapshot.evidenceItems
    .filter((i) => i.itemType === "crime_event")
    .sort((a, b) => {
      const at = typeof a.content.occurredAt === "string" ? a.content.occurredAt : "";
      const bt = typeof b.content.occurredAt === "string" ? b.content.occurredAt : "";
      return at < bt ? -1 : at > bt ? 1 : a.id < b.id ? -1 : 1;
    })[0];
  const label = event?.content.sceneLabel;
  if (typeof label !== "string") return null;
  return label.replace(/^[^—]*—\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
}

/**
 * The eight canonical questions from docs/demo/demo-contract.md §3,
 * with placeholders bound from persisted data. A question whose
 * placeholder cannot be bound is omitted rather than shown with a
 * dangling name.
 */
export function buildSuggestions(snapshot: CorpusSnapshot): SuggestedQuestion[] {
  const suggestions: SuggestedQuestion[] = [
    {
      id: "q1",
      question: "Who are the primary suspects in this case, and what aliases do they use?",
      hint: "Suspect records and alias records, read directly from evidence",
    },
  ];

  const pair = indirectPair(snapshot);
  if (pair) {
    suggestions.push({
      id: "q2",
      question: `What direct relationships exist between ${pair[0].canonicalLabel} and ${pair[1].canonicalLabel}?`,
      hint: "Requires graph traversal — the two are not directly linked",
    });
  }

  const money = longestMoneyPair(snapshot);
  if (money) {
    suggestions.push({
      id: "q3",
      question: `Is there a financial connection between ${money[0].canonicalLabel} and ${money[1].canonicalLabel}, and if so, what is the transaction path?`,
      hint: "Follows the account chain across persisted transactions",
    });
  }

  suggestions.push({
    id: "q4",
    question: "Are there any suspects whose phone activity places them at the same location at the same time as a crime event?",
    hint: "Spatial/temporal corroboration findings — co-location, not contact",
  });

  const scene = firstCrimeSceneLabel(snapshot);
  suggestions.push({
    id: "q5",
    question: scene
      ? `Are there any contradictions between witness statements regarding the ${scene}?`
      : "Are there any contradictions between witness statements in this case?",
    hint: "Conflicts are exposed with both sources, never resolved",
  });

  suggestions.push({
    id: "q6",
    question: "Which entity in this case has the most significant structural role in the network, and why?",
    hint: "Topology analytics — an algorithmic signal, not a finding of conduct",
  });

  const bridge = strongestBridgePerson(snapshot);
  if (bridge) {
    suggestions.push({
      id: "q7",
      question: `Is there evidence connecting ${bridge.canonicalLabel} to more than one principal suspect, and what is that evidence?`,
      hint: "Bridge signal plus the communication edges behind it",
    });
  }

  suggestions.push({
    id: "q8",
    question: "Summarize the case: what has been corroborated, and what remains only an inference or a lead?",
    hint: "Separates corroborated fact from signal, inference and lead",
  });

  return suggestions;
}

export async function getCopilotState(): Promise<CopilotState> {
  const readiness = await loadCopilotSnapshot();
  if (!readiness.ready) return { status: "not_available", reason: readiness.reason };

  const s = readiness.snapshot;
  const summary: CopilotSummary = {
    investigationId: s.investigationId,
    investigationName: s.investigationName,
    graphVersion: s.graphVersion,
    counts: {
      evidenceItems: s.evidenceItems.length,
      extractedRecords: s.extractedRecords.length,
      entities: s.entities.length,
      aliases: s.aliases.length,
      relationships: s.relationships.length,
      analyticalSignals: s.analyticalSignals.length,
      corroborationFindings: s.corroborationFindings.length,
    },
    modelConfigured: Boolean(getEnv().AI_PROVIDER_API_KEY),
    model: AI_MODEL_BASELINE,
    promptVersion: COPILOT_PROMPT_VERSION,
    schemaVersion: COPILOT_SCHEMA_VERSION,
    suggestions: buildSuggestions(s),
  };
  return { status: "ready", summary };
}
