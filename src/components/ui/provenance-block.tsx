import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The canonical six-field provenance render (audit §4 — AI / provenance
 * treatment; docs/requirements.md §8). A `[key | value]` mono grid with a
 * left accent border so it reads as an audit trail, and
 * `processingHistory` as a wrapped `→` chain.
 *
 * `confidence` is optional: graph node/edge provenance carries five of the
 * six fields (no per-item confidence), the dossier carries all six.
 */
export interface ProvenanceLike {
  source: string;
  location: string;
  method: string;
  confidence?: number;
  processingHistory: string[];
  timestamp: string;
}

export function ProvenanceBlock({
  provenance,
  className,
  ...props
}: React.ComponentProps<"div"> & { provenance: ProvenanceLike }) {
  const rows: [string, React.ReactNode][] = [
    ["source", provenance.source],
    ["location", provenance.location],
    ["method", provenance.method],
  ];
  if (typeof provenance.confidence === "number") {
    rows.push(["confidence", provenance.confidence.toFixed(2)]);
  }
  rows.push(
    ["history", provenance.processingHistory.join(" → ")],
    ["derived at", provenance.timestamp],
  );

  return (
    <div
      data-slot="provenance-block"
      className={cn(
        "grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-l-2 pl-2 text-[10px] text-fg-muted",
        className,
      )}
      style={{ borderLeftColor: "color-mix(in oklch, var(--accent) 55%, transparent)" }}
      {...props}
    >
      {rows.map(([key, value]) => (
        <React.Fragment key={key}>
          <span className="text-fg-faint">{key}</span>
          <span className="truncate font-mono">{value}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
