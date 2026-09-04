import { z } from "zod";

/**
 * The validation boundary for process environment configuration.
 *
 * Per docs/architecture/stack-contract.md, the application must start
 * without a real Anthropic API key — AI_PROVIDER_API_KEY is therefore
 * optional here. Anything that actually calls the AI layer (not yet
 * implemented) is responsible for checking it is present before use;
 * see src/lib/ai/client.ts.
 */
const envSchema = z.object({
  APP_ENV: z
    .enum(["development", "demo", "production"])
    .default("development"),
  DATABASE_URL: z.string().default("./data/cipher.db"),
  AI_PROVIDER_API_KEY: z.string().optional(),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parses and validates process.env once, caching the result. */
export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse({
      APP_ENV: process.env.APP_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      AI_PROVIDER_API_KEY: process.env.AI_PROVIDER_API_KEY,
      LOG_LEVEL: process.env.LOG_LEVEL,
    });
  }
  return cached;
}
