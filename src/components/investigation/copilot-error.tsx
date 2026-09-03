"use client";

import { AlertTriangle } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { CopilotError } from "@/lib/copilot/types";

const ERROR_TITLES: Record<CopilotError["code"], string> = {
  NO_INVESTIGATION: "No investigation loaded",
  NO_DERIVED_INTELLIGENCE: "Derived intelligence not ready",
  INVALID_QUESTION: "That question could not be accepted",
  RETRIEVAL_FAILURE: "Retrieval failed",
  VALIDATION_FAILURE: "The answer was withheld",
  INTERNAL_ERROR: "Something went wrong",
};

/**
 * The Copilot's service-error state. Distinct from the model-error
 * notice on an answered response: this is shown when NO validated
 * answer could be produced at all — including the deliberate case where
 * a composed answer failed the response contract or a citation did not
 * resolve, and was therefore withheld rather than shown.
 */
export function CopilotErrorView({ error }: { error: CopilotError }) {
  return (
    <Card className="gap-2 border-destructive/40" data-testid="copilot-error">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        <span className="text-sm font-semibold">{ERROR_TITLES[error.code]}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{error.code}</span>
      </div>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
          {error.issues.slice(0, 8).map((issue) => (
            <li key={issue} className="font-mono text-[10px]">
              {issue}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Nothing was asserted and nothing was persisted. Rephrase the question, or re-run the earlier pipeline stages if
        the case state has changed.
      </p>
    </Card>
  );
}
