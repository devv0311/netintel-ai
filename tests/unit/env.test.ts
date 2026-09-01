import { describe, expect, it, beforeEach, vi } from "vitest";

describe("getEnv", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.APP_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.AI_PROVIDER_API_KEY;
    delete process.env.LOG_LEVEL;
  });

  it("parses successfully with no environment variables set (no real API key required)", async () => {
    const { getEnv } = await import("@/lib/env");
    const env = getEnv();

    expect(env.APP_ENV).toBe("development");
    expect(env.DATABASE_URL).toBe("./data/netintel.db");
    expect(env.AI_PROVIDER_API_KEY).toBeUndefined();
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("is deterministic across repeated calls", async () => {
    const { getEnv } = await import("@/lib/env");
    expect(getEnv()).toEqual(getEnv());
  });
});
