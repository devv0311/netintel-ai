"use client";

import { useEffect, useState } from "react";
import { BarChart3, Loader2, Network, Search, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClassificationChip } from "@/components/ui/classification-chip";
import { ProvenanceBlock } from "@/components/ui/provenance-block";
import { formatCount } from "@/lib/format";
import type { EvidenceClassification } from "@/lib/domain/provenance";
import type { NodeDetail } from "@/lib/graph/types";
import type { EntityAnalyticsDetail } from "@/lib/analytics/types";

import type { InspectorContext } from "./types";

/**
 * The shared Entity Profile (M10.1 audit §1 #4 / §5 M10.3). One entity,
 * one surface — identity and kind, aliases, attributes, the structural
 * metrics and community from analytics, the six-field provenance, and
 * every connected entity (click to re-focus). Persisted data only: it
 * fetches `/api/graph/nodes/{id}` and `/api/analytics/entities/{id}` and
 * renders whichever came back — the graph screen is reachable before
 * analytics has run, so the metrics block is simply omitted then.
 *
 * `context` exists only to keep the `data-testid` each hosting screen's
 * e2e coverage already asserts (`graph-node-detail` in the graph screen,
 * `analytics-entity-detail` in analytics); the content is identical
 * everywhere.
 */
const KIND_LABELS: Record<string, string> = {
  person: "person",
  phone: "phone",
  imei: "imei",
  vehicle: "vehicle",
  bank_account: "bank account",
  organisation: "organisation",
  location: "location",
};

const ROOT_TESTID: Record<InspectorContext, string> = {
  graph: "graph-node-detail",
  analytics: "analytics-entity-detail",
  corroboration: "entity-profile",
};
const LABEL_TESTID: Record<InspectorContext, string | undefined> = {
  graph: "graph-node-label",
  analytics: "analytics-entity-label",
  corroboration: undefined,
};
const LOADING_TESTID: Record<InspectorContext, string> = {
  graph: "graph-node-detail-loading",
  analytics: "analytics-entity-detail-loading",
  corroboration: "entity-profile-loading",
};
const VIEW_IN_GRAPH_TESTID: Record<InspectorContext, string> = {
  graph: "entity-profile-view-in-graph",
  analytics: "analytics-view-in-graph",
  corroboration: "entity-profile-view-in-graph",
};

export function EntityProfile({
  entityId,
  context,
  onSelectEntity,
  onSelectRelationship,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
}: {
  entityId: string;
  context: InspectorContext;
  onSelectEntity: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onViewInGraph: (id: string) => void;
  onViewInAnalytics: (id: string) => void;
  onViewInCorroboration: (id: string) => void;
}) {
  // The loaded data carries the id it belongs to, so a stale response
  // never shows and no synchronous reset is needed when `entityId`
  // changes.
  const [data, setData] = useState<{
    id: string;
    node: NodeDetail | null;
    analytics: EntityAnalyticsDetail | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const nodeReq = fetch(`/api/graph/nodes/${encodeURIComponent(entityId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<NodeDetail>) : null))
      .catch(() => null);
    const analyticsReq = fetch(`/api/analytics/entities/${encodeURIComponent(entityId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EntityAnalyticsDetail>) : null))
      .catch(() => null);
    void Promise.all([nodeReq, analyticsReq]).then(([n, a]) => {
      if (!cancelled) setData({ id: entityId, node: n, analytics: a });
    });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const ready = data?.id === entityId;
  const node = ready ? data.node : null;
  const analytics = ready ? data.analytics : null;

  if (!ready) {
    return (
      <Card className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={LOADING_TESTID[context]}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading entity profile…
      </Card>
    );
  }

  if (!node && !analytics) {
    return (
      <Card className="text-xs text-muted-foreground" data-testid="entity-profile-not-found">
        Entity not found.
      </Card>
    );
  }

  const label = node?.label ?? analytics?.label ?? entityId;
  const kind = node?.kind ?? analytics?.kind ?? "entity";
  const labelTestid = LABEL_TESTID[context];

  return (
    <Card
      className="gap-3 text-xs"
      data-testid={ROOT_TESTID[context]}
      data-slot="entity-profile"
      data-inspector-context={context}
    >
      {/* IDENTITY */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold" data-testid={labelTestid}>
            {label}
          </span>
          <Badge variant="accent">{KIND_LABELS[kind] ?? kind}</Badge>
          {analytics?.communityId && (
            <Badge variant="outline" data-testid="entity-profile-community">
              community {analytics.communityId.slice(0, 14)}…
            </Badge>
          )}
        </div>
        {node && node.aliases.length > 0 && (
          <div className="text-muted-foreground" data-testid="graph-node-aliases">
            Aliases: {node.aliases.join(", ")}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            data-testid={VIEW_IN_GRAPH_TESTID[context]}
            onClick={() => onViewInGraph(entityId)}
          >
            <Network className="size-3.5" aria-hidden />
            Graph
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            data-testid="entity-profile-view-in-analytics"
            onClick={() => onViewInAnalytics(entityId)}
          >
            <BarChart3 className="size-3.5" aria-hidden />
            Analytics
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            data-testid="entity-profile-view-in-corroboration"
            onClick={() => onViewInCorroboration(entityId)}
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            Corroboration
          </Button>
        </div>
      </div>

      {/* ATTRIBUTES */}
      {node && Object.keys(node.attributes).length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-2" data-testid="entity-profile-attributes">
          <span className="font-medium text-foreground">Attributes</span>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            {Object.entries(node.attributes).map(([k, v]) => (
              <span key={k}>
                {k}: {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* STRUCTURAL METRICS — from analytics, always an Algorithmic Signal */}
      {analytics && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2" data-testid="entity-profile-metrics">
          <span className="font-medium text-foreground">
            Structural metrics <span className="text-[10px] font-normal text-muted-foreground">· Algorithmic Signal</span>
          </span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
            <span>Degree: {formatCount(analytics.degree.total)}</span>
            <span>Weighted: {formatCount(analytics.degree.weighted)}</span>
            <span>Incoming: {formatCount(analytics.degree.incoming)}</span>
            <span>Outgoing: {formatCount(analytics.degree.outgoing)}</span>
          </div>
          {Object.keys(analytics.degree.byRelationshipType).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(analytics.degree.byRelationshipType).map(([type, n]) => (
                <Badge key={type} variant="outline">
                  {type}: {n}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ALGORITHMIC SIGNALS targeting this entity */}
      {analytics && analytics.signals.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <span className="font-medium text-foreground">
            Algorithmic signals ({formatCount(analytics.signals.length)})
          </span>
          <ul className="flex flex-col gap-1.5">
            {analytics.signals.map((s) => (
              <li key={s.id} className="rounded bg-muted/40 p-1.5" data-testid="analytics-entity-signal">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{s.signalType}</Badge>
                  <ClassificationChip classification={s.classification as EvidenceClassification} />
                  <span className="ml-auto text-muted-foreground">confidence {s.confidence.toFixed(2)}</span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{s.explanation}</p>
                {s.supportingEdgeIds.length > 0 && (
                  <span className="text-muted-foreground">
                    Supporting edges: {formatCount(s.supportingEdgeIds.length)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PROVENANCE */}
      {node && (
        <ProvenanceBlock
          provenance={node.provenance}
          className="border-t border-border pt-2"
          data-testid="entity-profile-provenance"
        />
      )}

      {/* CONNECTED ENTITIES */}
      {node && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <span className="font-medium text-foreground">
            Connected entities ({formatCount(node.edges.length)})
          </span>
          {node.edges.length === 0 && <span className="text-muted-foreground">No connections.</span>}
          <ul className="flex flex-col gap-1">
            {node.edges.map((e) => (
              <li key={e.id} className="flex items-center gap-1 rounded hover:bg-muted">
                <button
                  type="button"
                  onClick={() => onSelectEntity(e.otherNodeId)}
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
                <button
                  type="button"
                  onClick={() => onSelectRelationship(e.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Inspect this relationship's evidence"
                  data-testid="graph-node-connection-inspect"
                >
                  <Search className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
