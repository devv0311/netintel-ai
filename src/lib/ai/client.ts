import Anthropic from "@anthropic-ai/sdk";

import { getEnv } from "@/lib/env";

/**
 * The AI integration boundary. Per docs/architecture/stack-contract.md,
 * inference is remote (Claude API), model baseline claude-opus-5, and
 * every response must eventually be cached to a composite key of
 * (model, prompt version, schema version, normalized input, generation
 * config) rather than input alone — see docs/architecture/technology-stack.md
 * "LLM Response Cache". Neither extraction, entity-resolution
 * adjudication, nor the Copilot is implemented yet; this module only
 * establishes how a client will be obtained when they are.
 *
 * The client is constructed lazily, on first call, so the application
 * can start with no AI_PROVIDER_API_KEY present at all.
 */
let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const env = getEnv();
    if (!env.AI_PROVIDER_API_KEY) {
      throw new Error(
        "AI_PROVIDER_API_KEY is not set. Set it in your local .env before making an AI call.",
      );
    }
    client = new Anthropic({ apiKey: env.AI_PROVIDER_API_KEY });
  }
  return client;
}

export const AI_MODEL_BASELINE = "claude-opus-5";
