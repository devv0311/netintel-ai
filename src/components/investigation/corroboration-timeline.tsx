"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import type { CorroborationFindingView } from "@/lib/corroboration/types";

/**
 * A compact, deterministic timeline for temporal / repeated-overlap
 * findings — one horizontal lane per finding, its bar spanning the
 * observed window mapped onto the shared min→max time axis. Communicates
 * *when* activity overlapped at a glance, so the screen reads like an
 * investigator's timeline rather than a table of timestamps. Pure
 * layout maths — no charting dependency.
 */
export function CorroborationTimeline({
  findings,
  selectedId,
  onSelect,
}: {
  findings: CorroborationFindingView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = useMemo(() => {
    const dated = findings.filter((f) => f.window);
    if (dated.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const f of dated) {
      const s = Date.parse(f.window!.start);
      const e = Date.parse(f.window!.end ?? f.window!.start);
      if (s < min) min = s;
      if (e > max) max = e;
    }
    const span = Math.max(1, max - min);
    return {
      min,
      max,
      lanes: dated.map((f) => {
        const s = Date.parse(f.window!.start);
        const e = Date.parse(f.window!.end ?? f.window!.start);
        const left = ((s - min) / span) * 100;
        const width = Math.max(1.5, ((e - s) / span) * 100);
        return { finding: f, left, width };
      }),
    };
  }, [findings]);

  if (!rows) {
    return (
      <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        No dated findings to plot on the timeline.
      </div>
    );
  }

  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-1.5" data-testid="corroboration-timeline">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{fmt(rows.min)}</span>
        <span>{fmt(rows.max)}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.lanes.map(({ finding, left, width }) => {
          const isSelected = finding.id === selectedId;
          const isCorroborated = finding.classification === "corroborated_fact";
          return (
            <li key={finding.id}>
              <button
                type="button"
                onClick={() => onSelect(finding.id)}
                data-testid="timeline-lane"
                className={cn(
                  "relative block h-6 w-full overflow-hidden rounded bg-muted/50 text-left",
                  isSelected && "ring-1 ring-accent",
                )}
                title={`${finding.entities.map((e) => e.label).join(" ↔ ")} — ${finding.window!.start}${
                  finding.window!.end ? ` → ${finding.window!.end}` : ""
                }`}
              >
                <span
                  className={cn(
                    "absolute inset-y-1 rounded",
                    isCorroborated ? "bg-accent" : "bg-foreground/40",
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  aria-hidden
                />
                <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center truncate pr-2 text-[10px] font-medium text-foreground">
                  {finding.entities.map((e) => e.label).join(" ↔ ")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
