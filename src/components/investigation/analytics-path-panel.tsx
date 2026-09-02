"use client";

import { useCallback, useState } from "react";
import { Network, Route } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PathResult, RankedEntityView } from "@/lib/analytics/types";
import type { RelationshipType } from "@/lib/domain/relationship";

const RELATIONSHIP_TYPES: RelationshipType[] = [
  "ownership",
  "communication",
  "financial",
  "co_location",
  "family",
  "associate",
  "other",
];

/**
 * Shortest-path investigation: pick a source and target entity,
 * optionally restrict traversal to specific relationship types, and
 * inspect the resulting path — every edge in a found path traces back
 * to a real, persisted relationship (never a manufactured one), and a
 * missing connection renders as a clear "no path" result rather than
 * an error. "View in graph" hands off to the Graph screen focused on
 * the source entity's neighborhood so the investigator can inspect the
 * underlying edges directly.
 */
export function AnalyticsPathPanel({
  entityOptions,
  onViewInGraph,
}: {
  entityOptions: RankedEntityView[];
  onViewInGraph: (entityId: string) => void;
}) {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [allowedTypes, setAllowedTypes] = useState<Set<RelationshipType>>(new Set());
  const [result, setResult] = useState<PathResult | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleType = useCallback((type: RelationshipType) => {
    setAllowedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const findPath = useCallback(async () => {
    if (!sourceId || !targetId) return;
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ source: sourceId, target: targetId });
      if (allowedTypes.size > 0) params.set("types", [...allowedTypes].join(","));
      const res = await fetch(`/api/analytics/path?${params.toString()}`, { cache: "no-store" });
      if (res.ok) setResult((await res.json()) as PathResult);
    } finally {
      setLoading(false);
    }
  }, [sourceId, targetId, allowedTypes]);

  const sortedOptions = [...entityOptions].sort((a, b) => a.label.localeCompare(b.label));
  const labelById = new Map(entityOptions.map((e) => [e.id, e.label]));

  return (
    <Card className="gap-3 text-xs" data-testid="analytics-path-panel">
      <div className="flex items-center gap-1.5">
        <Route className="size-4 text-accent" aria-hidden />
        <span className="text-sm font-semibold">Shortest-path investigation</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="path-source" className="font-medium">
            Source entity
          </label>
          <select
            id="path-source"
            data-testid="path-source-picker"
            className="rounded-md border border-border bg-card px-2 py-1"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Select…</option>
            {sortedOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} ({e.kind})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="path-target" className="font-medium">
            Target entity
          </label>
          <select
            id="path-target"
            data-testid="path-target-picker"
            className="rounded-md border border-border bg-card px-2 py-1"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Select…</option>
            {sortedOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label} ({e.kind})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">Relationship types (none = all):</span>
        {RELATIONSHIP_TYPES.map((type) => (
          <Badge
            key={type}
            variant={allowedTypes.has(type) ? "accent" : "outline"}
            className="cursor-pointer"
            onClick={() => toggleType(type)}
            data-testid={`path-filter-${type}`}
          >
            {type}
          </Badge>
        ))}
      </div>

      <div>
        <Button
          size="sm"
          onClick={findPath}
          disabled={!sourceId || !targetId || loading}
          className="gap-2"
          data-testid="find-path-button"
        >
          <Route className="size-3.5" aria-hidden />
          {loading ? "Finding path…" : "Find path"}
        </Button>
      </div>

      {result && result.found && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2" data-testid="path-result-found">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              Path found — {result.hopCount} hop{result.hopCount === 1 ? "" : "s"}
            </span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onViewInGraph(result.sourceEntityId)}>
              <Network className="size-3.5" aria-hidden />
              View in graph
            </Button>
          </div>
          <ol className="flex flex-wrap items-center gap-1.5" data-testid="path-node-sequence">
            {result.nodeIds.map((nodeId, i) => (
              <li key={nodeId} className="flex items-center gap-1.5">
                <Badge variant="outline">{labelById.get(nodeId) ?? nodeId}</Badge>
                {i < result.nodeIds.length - 1 && <span aria-hidden>→</span>}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1">
            {result.edges.map((edge) => (
              <div key={edge.id} className="flex flex-wrap items-center gap-1.5 rounded bg-muted/40 p-1.5" data-testid="path-edge">
                <Badge variant="accent">{edge.relationshipType}</Badge>
                <Badge variant="outline">{edge.classification.replaceAll("_", " ")}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">{edge.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && !result.found && (
        <div className="rounded-md bg-muted px-2.5 py-1.5 text-muted-foreground" data-testid="path-result-not-found">
          No path found: {result.reason}
        </div>
      )}
    </Card>
  );
}
