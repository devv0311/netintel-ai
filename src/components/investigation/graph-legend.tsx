import { EDGE_LABELS, EDGE_TYPES, EDGE_VAR, KIND_LABELS, NODE_KINDS, KIND_VAR } from "@/lib/graph/tokens";

/**
 * The graph canvas legend (M10.4): what every node color and edge
 * treatment means. Pure presentation over the same `--kind-*` / `--edge-*`
 * tokens the canvas itself reads (`@/lib/graph/tokens`) — never a second,
 * hardcoded palette.
 */
export function GraphLegend() {
  return (
    <div
      className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs"
      data-testid="graph-legend"
    >
      <div className="flex flex-col gap-1">
        <span className="font-medium text-fg">Entity kind</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {NODE_KINDS.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5 text-fg-muted">
              <span
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ background: `var(${KIND_VAR[kind]})` }}
                aria-hidden
              />
              {KIND_LABELS[kind]}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium text-fg">Relationship type</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {EDGE_TYPES.map((type) => (
            <span key={type} className="flex items-center gap-1.5 text-fg-muted">
              <span
                className="inline-block h-0.5 w-4 shrink-0"
                style={{ background: `var(${EDGE_VAR[type]})` }}
                aria-hidden
              />
              {EDGE_LABELS[type]}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium text-fg">Provenance</span>
        <span className="flex items-center gap-1.5 text-fg-muted">
          <svg width="20" height="8" aria-hidden>
            <line x1="0" y1="4" x2="20" y2="4" stroke="var(--fg-muted)" strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          Dashed = AI inference
        </span>
      </div>
    </div>
  );
}
