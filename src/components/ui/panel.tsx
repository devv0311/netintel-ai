import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The three surface weights of the M10 visual system (audit §4 — density):
 *
 *   hero   — a screen's primary visualisation region (canvas, map,
 *            timeline, report body). Generous, one per surface.
 *   panel  — inspector columns, list columns, the command bar. 12px base.
 *   inset  — provenance blocks, metric grids, id-chip strips. Subdued
 *            surface, tighter rhythm.
 *
 * This is the successor to the one-size `Card`; `Card` stays exported and
 * unchanged for surfaces not yet migrated (that migration is M10.3+).
 */
type PanelWeight = "hero" | "panel" | "inset";

const WEIGHT_CLASS: Record<PanelWeight, string> = {
  hero: "rounded-lg border border-border bg-surface-1 p-4",
  panel: "rounded-lg border border-border bg-surface-2 p-3",
  inset: "rounded-md border border-border bg-surface-3/60 p-2",
};

export function Panel({
  weight = "panel",
  className,
  ...props
}: React.ComponentProps<"div"> & { weight?: PanelWeight }) {
  return (
    <div
      data-slot="panel"
      data-weight={weight}
      className={cn("flex flex-col gap-2 text-fg", WEIGHT_CLASS[weight], className)}
      {...props}
    />
  );
}
