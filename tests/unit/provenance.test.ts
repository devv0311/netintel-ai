import { describe, expect, it } from "vitest";

import { EVIDENCE_CLASSIFICATIONS } from "@/lib/domain/provenance";

describe("EVIDENCE_CLASSIFICATIONS", () => {
  it("matches the five classifications required by docs/requirements.md §7", () => {
    expect(EVIDENCE_CLASSIFICATIONS).toEqual([
      "observed_fact",
      "corroborated_fact",
      "algorithmic_signal",
      "ai_inference",
      "investigative_lead",
    ]);
  });
});
