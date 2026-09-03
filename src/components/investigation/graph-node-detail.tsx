"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ClassificationChip } from "@/components/ui/classification-chip";
import { ProvenanceBlock } from "@/components/ui/provenance-block";
import { formatCount } from "@/lib/format";
import type { EvidenceClassification } from "@/lib/domain/provenance";
import type { NodeDetail } from "@/lib/graph/types";

const KIND_LABELS: Record<string, string> = {
  person: "person",
  phone: "phone",
  imei: "imei",
  vehicle: "vehicle",
  bank_account: "bank account",
  location: "location",
};

/**
 * The selected-node detail panel: kind, label, aliases, attributes,
 * provenance, and every connected entity — satisfying "inspect
 * connected entities" by letting a click on any connected row re-focus
 * the graph on that neighbor.
 */
export function GraphNodeDetail({
  nodeId,
  onSelectNode,
  onSelectEdge,
}: {
  nodeId: string;
  onSelectNode: (id: string) => void;
  onSelectEdge?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Keyed by nodeId at the call site (see graph-screen.tsx), so a fresh
  // mount already starts from loading=true/detail=null — this effect
  // only ever needs to set state from inside the fetch's own callbacks.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph/nodes/${encodeURIComponent(nodeId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<NodeDetail>) : null))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (loading) {
    return (
      <Card className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="graph-node-detail-loading">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading node detail…
      </Card>
    );
  }

  if (!detail) {
    return <Card className="text-xs text-muted-foreground">Node not found.</Card>;
  }

  return (
    <Card className="gap-3 text-xs" data-testid="graph-node-detail">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold" data-testid="graph-node-label">
            {detail.label}
          </span>
          <Badge variant="accent">{KIND_LABELS[detail.kind] ?? detail.kind}</Badge>
        </div>
        {detail.aliases.length > 0 && (
          <div className="text-muted-foreground" data-testid="graph-node-aliases">
            Aliases: {detail.aliases.join(", ")}
          </div>
        )}
        <ProvenanceBlock provenance={detail.provenance} className="mt-1" />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="font-medium text-foreground">
          Connected entities ({formatCount(detail.edges.length)})
        </span>
        {detail.edges.length === 0 && <span className="text-muted-foreground">No connections.</span>}
        <ul className="flex flex-col gap-1">
          {detail.edges.map((e) => (
            <li key={e.id} className="flex items-center gap-1 rounded hover:bg-muted">
              <button
                type="button"
                onClick={() => onSelectNode(e.otherNodeId)}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
                data-testid="graph-node-connection"
              >
                <span aria-hidden>{e.direction === "outgoing" ? "→" : "←"}</span>
                <Badge variant="outline">{e.relationshipType}</Badge>
                <span className="truncate">{e.otherNodeLabel}</span>
                <ClassificationChip
                  classification={e.classification as EvidenceClassification}
                  className="ml-auto shrink-0"
                />
              </button>
              {onSelectEdge && (
                <button
                  type="button"
                  onClick={() => onSelectEdge(e.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Inspect this relationship's evidence"
                  data-testid="graph-node-connection-inspect"
                >
                  <Search className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
