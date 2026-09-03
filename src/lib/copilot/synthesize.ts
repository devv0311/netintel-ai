import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { AI_MODEL_BASELINE, getAnthropicClient } from "@/lib/ai/client";
import {
  buildCacheKey,
  normalizeInput,
  readCache,
  writeCache,
  type CacheOutcome,
  type GenerationConfig,
} from "@/lib/ai/cache";
import { getEnv } from "@/lib/env";

import { COPILOT_SCHEMA_VERSION, ModelAnswerSchema, type CopilotClaim, type ModelAnswer } from "./contract";
import { COPILOT_PROMPT_VERSION, COPILOT_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import type { EvidencePack } from "./retrieval";
import type { CopilotModelError, CopilotSynthesisMode, QuestionGrounding } from "./types";
import { validateModelAnswer } from "./verify";

/**
 * The Claude synthesis layer.
 *
 * It is a NARRATOR, never a source of truth: it receives the
 * deterministic grounded claim set from ./retrieval.ts and returns
 * wording for it. Its output is validated by ./verify.ts before it is
 * used at all, and any failure — no key, a failed request, a schema
 * breach, a fabricated literal, an unsupported contact/causation claim
 * — discards the model wording entirely and leaves the caller with the
 * deterministic narration.
 *
 * Every call goes through the on-disk LLM response cache
 * (src/lib/ai/cache.ts), keyed on model, prompt version, schema
 * version, normalized input AND generation configuration per
 * docs/architecture/technology-stack.md §3, so a repeated question
 * replays offline and identically. A cache HIT is re-validated through
 * exactly the same guardrails as a fresh response — a hand-edited cache
 * entry must not be able to smuggle an ungrounded answer past them.
 */

/** Part of the cache identity: any change here must miss the cache. */
export const COPILOT_GENERATION_CONFIG: GenerationConfig = {
  maxTokens: 1500,
  temperature: 0,
  extra: { effort: "medium" },
};

export interface SynthesisOutcome {
  mode: CopilotSynthesisMode;
  /** Present only when `mode` is "llm_synthesis". */
  answer: ModelAnswer | null;
  cache: CacheOutcome;
  modelError: CopilotModelError | null;
  rejections: string[];
  /** The composite cache key this question maps to, for debugging and replay. */
  cacheKey: string;
}

function identityFor(input: string) {
  return {
    model: AI_MODEL_BASELINE,
    modelVersion: AI_MODEL_BASELINE,
    promptVersion: COPILOT_PROMPT_VERSION,
    schemaVersion: COPILOT_SCHEMA_VERSION,
    input,
    generationConfig: COPILOT_GENERATION_CONFIG,
  };
}

/** The exact text hashed into the cache key — a pure function of question + retrieved records. */
export function synthesisInput(grounding: QuestionGrounding, pack: EvidencePack, claims: readonly CopilotClaim[]): string {
  return normalizeInput(`${COPILOT_SYSTEM_PROMPT}\n\n${buildUserPrompt(grounding, pack, claims)}`);
}

export async function synthesizeAnswer(
  grounding: QuestionGrounding,
  pack: EvidencePack,
  claims: readonly CopilotClaim[],
): Promise<SynthesisOutcome> {
  const input = synthesisInput(grounding, pack, claims);
  const identity = identityFor(input);
  const cacheKey = buildCacheKey(identity);
  const question = grounding.normalizedQuestion;

  const cached = readCache<unknown>(identity);
  if (cached) {
    const check = validateModelAnswer(cached.response, claims, pack, question);
    if (check.ok) {
      return { mode: "llm_synthesis", answer: check.answer, cache: "hit", modelError: null, rejections: [], cacheKey };
    }
    return {
      mode: "deterministic_fallback",
      answer: null,
      cache: "hit",
      modelError: {
        code: "MODEL_OUTPUT_REJECTED",
        message: "A cached model answer failed the grounding guardrails and was discarded.",
        rejections: check.rejections,
      },
      rejections: check.rejections,
      cacheKey,
    };
  }

  if (!getEnv().AI_PROVIDER_API_KEY) {
    return {
      mode: "deterministic",
      answer: null,
      cache: "bypass",
      modelError: {
        code: "MODEL_NOT_CONFIGURED",
        message:
          "No AI provider key is configured, so the answer below is the deterministic narration of the same grounded evidence. Nothing about the evidence, citations, or classifications changes.",
      },
      rejections: [],
      cacheKey,
    };
  }

  let raw: unknown;
  try {
    const message = await getAnthropicClient().messages.parse({
      model: AI_MODEL_BASELINE,
      max_tokens: COPILOT_GENERATION_CONFIG.maxTokens,
      temperature: COPILOT_GENERATION_CONFIG.temperature,
      system: COPILOT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(grounding, pack, claims) }],
      output_config: { format: zodOutputFormat(ModelAnswerSchema), effort: "medium" },
    });
    raw = message.parsed_output;
  } catch (err) {
    // Never surface a provider error string: it can carry request ids,
    // account hints, or key fragments.
    console.error("[copilot] model request failed", err);
    return {
      mode: "deterministic",
      answer: null,
      cache: "miss",
      modelError: {
        code: "MODEL_REQUEST_FAILED",
        message:
          "The AI provider could not be reached, so the answer below is the deterministic narration of the same grounded evidence.",
      },
      rejections: [],
      cacheKey,
    };
  }

  const check = validateModelAnswer(raw, claims, pack, question);
  if (!check.ok) {
    return {
      mode: "deterministic_fallback",
      answer: null,
      cache: "miss",
      modelError: {
        code: "MODEL_OUTPUT_REJECTED",
        message: "The model answer failed the grounding guardrails and was discarded; deterministic narration is shown instead.",
        rejections: check.rejections,
      },
      rejections: check.rejections,
      cacheKey,
    };
  }

  // Only a guardrail-clean answer is ever written to the cache, so a
  // replay can never serve an answer the live path would have rejected.
  writeCache(identity, check.answer);
  return { mode: "llm_synthesis", answer: check.answer, cache: "miss", modelError: null, rejections: [], cacheKey };
}
