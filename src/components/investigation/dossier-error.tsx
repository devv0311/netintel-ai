"use client";

import { AlertTriangle } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { DossierError } from "@/lib/dossier/types";

const ERROR_TITLES: Record<DossierError["code"], string> = {
  NO_INVESTIGATION: "No investigation loaded",
  NO_GRAPH: "The case graph has not been synthesized",
  NO_DERIVED_INTELLIGENCE: "Derived intelligence not ready",
  INSUFFICIENT_EVIDENCE: "Nothing substantive to report",
  VALIDATION_FAILURE: "The report was withheld",
  TRACEABILITY_FAILURE: "The report was withheld",
  PERSISTENCE_FAILURE: "The report could not be saved",
  INTERNAL_ERROR: "Something went wrong",
};

/**
 * The dossier's service-error state.
 *
 * `VALIDATION_FAILURE` and `TRACEABILITY_FAILURE` are the deliberate
 * cases, not accidents: a report whose claims could not all be
 * classified and traced is withheld in full rather than emitted with
 * the offending findings quietly dropped (blueprint H2). The issue list
 * names the specific findings so the failure is actionable.
 */
export function DossierErrorView({ error }: { error: DossierError }) {
  const withheld = error.code === "VALIDATION_FAILURE" || error.code === "TRACEABILITY_FAILURE";

  return (
    <Card className="gap-2 border-destructive/40" data-testid="dossier-error">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="text-sm font-semibold">{ERROR_TITLES[error.code]}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground" data-testid="dossier-error-code">
          {error.code}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
          {error.issues.slice(0, 8).map((issue) => (
            <li key={issue} className="font-mono text-[10px]">
              {issue}
            </li>
          ))}
          {error.issues.length > 8 && (
            <li className="text-[10px]">+{error.issues.length - 8} more</li>
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {withheld
          ? "No report was written. The dossier fails as a whole rather than publishing a partial report — a report that quietly dropped a finding would be worse than none."
          : "No report was written. Complete the earlier pipeline stages, then generate the dossier again."}
      </p>
    </Card>
  );
}
