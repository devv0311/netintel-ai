import { ShieldAlert, Crosshair, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PipelineStatus } from "./pipeline-status";

/**
 * The command bar (audit §2 — persistent context). A fixed strip that
 * carries, at all times:
 *   - the product identity ("CIPHER" / "Investigation Workspace");
 *   - the loaded case's name and corpus version, once ingestion has run;
 *   - the live pipeline meter (real `completedStages`, never fabricated);
 *   - the current cross-navigation subject as a dismissible focus chip;
 *   - the non-removable synthetic-data marker.
 */
export function Header({
  caseName,
  caseDetail,
  completedStages,
  focusedEntityId,
  onClearFocus,
}: {
  caseName: string | null;
  caseDetail: string | null;
  completedStages: readonly string[];
  focusedEntityId: string | null;
  onClearFocus: () => void;
}) {
  const shortFocus =
    focusedEntityId && focusedEntityId.length > 14
      ? `${focusedEntityId.slice(0, 10)}…`
      : focusedEntityId;

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-sm">
            NI
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-fg">CIPHER</span>
            <span className="text-xs text-fg-muted">Investigation Workspace</span>
          </div>
        </div>

        {caseName && (
          <div
            className="flex flex-col border-l border-border pl-3 leading-tight"
            data-testid="command-case"
          >
            <span className="text-xs font-medium text-fg">{caseName}</span>
            {caseDetail && (
              <span className="font-mono text-[10px] text-fg-faint">{caseDetail}</span>
            )}
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {focusedEntityId && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-accent-quiet/40 px-2 py-0.5 text-xs text-fg"
              data-testid="command-focus-chip"
              title={`Focused entity: ${focusedEntityId}`}
            >
              <Crosshair className="size-3 text-accent" aria-hidden />
              <span className="font-mono text-[10px]">{shortFocus}</span>
              <button
                type="button"
                onClick={onClearFocus}
                aria-label="Clear focused entity"
                data-testid="command-focus-clear"
                className="rounded p-0.5 text-fg-muted hover:text-fg"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          )}
          <Badge variant="outline" className="gap-1.5">
            <ShieldAlert className="size-3" aria-hidden />
            Synthetic data only — not a real investigation
          </Badge>
        </div>
      </div>

      <PipelineStatus completed={completedStages} />
    </header>
  );
}
