import * as React from "react";

import { cn } from "@/lib/utils";
import type { EvidenceClassification } from "@/lib/domain/provenance";

/**
 * The canonical evidence-classification chip (audit §4 — AI / provenance
 * treatment). The whole product is built around the five-label
 * classification vocabulary, so the five must never read alike: each gets
 * its own fill / text / border-style / glyph, driven by the `--cls-*`
 * tokens in globals.css (which also carry a coherent light variant).
 *
 * Drop-in for the old `Badge variant={badgeVariant(...)}` calls, which
 * gave three of the five an identical outline. Callers keep their own
 * `data-testid` by passing it through — it is spread last and wins.
 */

const LABELS: Record<EvidenceClassification, string> = {
  observed_fact: "Observed Fact",
  corroborated_fact: "Corroborated Fact",
  algorithmic_signal: "Algorithmic Signal",
  ai_inference: "AI Inference",
  investigative_lead: "Investigative Lead",
};

const NOTES: Record<EvidenceClassification, string> = {
  observed_fact: "Stated directly in one source, no inference applied.",
  corroborated_fact: "Independently supported by two or more distinct sources.",
  algorithmic_signal: "A computed property of the data — not a claim about people.",
  ai_inference: "Goes beyond directly observed evidence — treat as provisional.",
  investigative_lead: "A prompt for further work. Not a claim of fact at any confidence.",
};

type Treatment = { token: string; borderStyle: "solid" | "dashed" | "dotted"; glyph: string };

const TREATMENT: Record<EvidenceClassification, Treatment> = {
  observed_fact: { token: "observed", borderStyle: "solid", glyph: "●" },
  corroborated_fact: { token: "corroborated", borderStyle: "solid", glyph: "✓✓" },
  algorithmic_signal: { token: "signal", borderStyle: "solid", glyph: "∿" },
  ai_inference: { token: "inference", borderStyle: "dashed", glyph: "◇" },
  investigative_lead: { token: "lead", borderStyle: "dotted", glyph: "⚑" },
};

export function classificationLabel(classification: EvidenceClassification): string {
  return LABELS[classification];
}

export function classificationNote(classification: EvidenceClassification): string {
  return NOTES[classification];
}

export function ClassificationChip({
  classification,
  confidence,
  showConfidence = false,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  classification: EvidenceClassification;
  confidence?: number;
  showConfidence?: boolean;
}) {
  // The persisted classification vocabulary is fixed, but some view
  // types carry it as a loose `string`; fall back to a neutral look
  // rather than crash if an unexpected value ever reaches here.
  const t = TREATMENT[classification] ?? TREATMENT.observed_fact;
  const label = LABELS[classification] ?? String(classification);
  return (
    <span
      data-slot="classification-chip"
      data-classification={classification}
      title={NOTES[classification]}
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        className,
      )}
      style={{
        background: `var(--cls-${t.token}-bg)`,
        color: `var(--cls-${t.token}-fg)`,
        borderColor: `var(--cls-${t.token}-border)`,
        borderStyle: t.borderStyle,
        ...style,
      }}
      {...props}
    >
      <span aria-hidden className="text-[0.9em] leading-none opacity-80">
        {t.glyph}
      </span>
      {label}
      {showConfidence && typeof confidence === "number" && (
        <span className="ml-0.5 font-mono text-[10px] opacity-70">{confidence.toFixed(2)}</span>
      )}
    </span>
  );
}
