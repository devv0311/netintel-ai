"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type {
  AnalyticsState,
  BridgeEntityView,
  CommunityView,
  RankedEntitiesPage,
  RankedEntityView,
} from "@/lib/analytics/types";

import { AnalyticsEntityDetail } from "./analytics-entity-detail";
import { AnalyticsPathPanel } from "./analytics-path-panel";

type ListTab = "ranked" | "bridges" | "communities";

const KIND_LABELS: Record<string, string> = {
  person: "person",
  phone: "phone",
  imei: "imei",
  vehicle: "vehicle",
  bank_account: "bank account",
  location: "location",
};

/**
 * The topology analytics screen (P5.6): ranked structurally-prominent
 * entities, bridge/intermediary entities, communities/clusters, entity
 * metric detail, and shortest-path investigation — every result
 * labeled Algorithmic Signal, never a claim of guilt or criminal
 * involvement. The investigator workflow this supports:
 *
 *   open Analytics → see structurally prominent entities → select one
 *   → inspect its metrics and community → view it in the graph → pick
 *   two entities → find the path between them → trace it to evidence
 *
 * Every rendered signal is real, persisted analytics output — never
 * decorative or fabricated. Links naturally back to the Graph screen
 * via `onViewInGraph`.
 */
export function AnalyticsScreen({
  initialState,
  onViewInGraph,
}: {
  initialState: AnalyticsState;
  onViewInGraph: (entityId: string) => void;
}) {
  const [tab, setTab] = useState<ListTab>("ranked");
  const [rankedPage, setRankedPage] = useState<RankedEntitiesPage | null>(null);
  const [bridges, setBridges] = useState<BridgeEntityView[] | null>(null);
  const [communities, setCommunities] = useState<CommunityView[] | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  useEffect(() => {
    if (initialState.status !== "synthesized") return;
    let cancelled = false;
    void Promise.all([
      fetch("/api/analytics/entities?limit=100", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/analytics/bridges", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/analytics/communities", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([ranked, bridgeData, communityData]) => {
      if (cancelled) return;
      if (ranked) setRankedPage(ranked as RankedEntitiesPage);
      if (bridgeData) setBridges((bridgeData as { bridges: BridgeEntityView[] }).bridges);
      if (communityData) setCommunities((communityData as { communities: CommunityView[] }).communities);
    });
    return () => {
      cancelled = true;
    };
  }, [initialState]);

  const loadMoreRanked = useCallback(async () => {
    if (!rankedPage) return;
    const nextOffset = rankedPage.offset + rankedPage.entities.length;
    const res = await fetch(`/api/analytics/entities?offset=${nextOffset}&limit=25`, { cache: "no-store" });
    if (!res.ok) return;
    const page = (await res.json()) as RankedEntitiesPage;
    setRankedPage((prev) => (prev ? { ...page, entities: [...prev.entities, ...page.entities] } : page));
  }, [rankedPage]);

  if (initialState.status !== "synthesized") {
    return (
      <Card className="mx-auto mt-8 max-w-md text-center text-sm text-muted-foreground" data-testid="analytics-unavailable">
        Topology analytics has not been run yet. Return to Evidence and run analytics once the graph has
        been synthesized.
      </Card>
    );
  }

  const { summary } = initialState;
  const entityOptions: RankedEntityView[] = rankedPage?.entities ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="analytics-screen">
      <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Synthetic data only. Every metric below is an <strong>Algorithmic Signal</strong> — a structural
          description of the fabricated Operation DarkNet Delhi graph, never a claim of guilt or criminal
          involvement.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="analytics-overview">
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="analytics-overview-nodes">
            {formatCount(summary.counts.entitiesAnalyzed)}
          </span>
          <span className="text-xs text-muted-foreground">Entities analyzed</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="analytics-overview-edges">
            {formatCount(summary.counts.edgesAnalyzed)}
          </span>
          <span className="text-xs text-muted-foreground">Edges analyzed</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums">{formatCount(summary.counts.bridgeEntities)}</span>
          <span className="text-xs text-muted-foreground">Bridge entities</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums">{formatCount(summary.counts.communities)}</span>
          <span className="text-xs text-muted-foreground">Communities</span>
        </Card>
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex gap-1.5 text-xs" data-testid="analytics-tabs">
            <Button size="sm" variant={tab === "ranked" ? "default" : "outline"} onClick={() => setTab("ranked")} data-testid="tab-ranked">
              Ranked entities
            </Button>
            <Button size="sm" variant={tab === "bridges" ? "default" : "outline"} onClick={() => setTab("bridges")} data-testid="tab-bridges">
              Bridge entities
            </Button>
            <Button
              size="sm"
              variant={tab === "communities" ? "default" : "outline"}
              onClick={() => setTab("communities")}
              data-testid="tab-communities"
            >
              Communities
            </Button>
          </div>

          {tab === "ranked" && (
            <Card data-testid="ranked-entities-list">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Ranked by structural prominence</span>
                <span className="text-muted-foreground">
                  Showing {formatCount(rankedPage?.entities.length ?? 0)} of {formatCount(rankedPage?.total ?? 0)}
                </span>
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                {rankedPage?.entities.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedEntityId(e.id)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                      data-testid="ranked-entity-row"
                      data-entity-id={e.id}
                    >
                      <span className="w-8 shrink-0 text-muted-foreground">#{e.rank}</span>
                      <span className="truncate font-medium text-foreground">{e.label}</span>
                      <Badge variant="outline">{KIND_LABELS[e.kind] ?? e.kind}</Badge>
                      <span className="ml-auto shrink-0 text-muted-foreground">score {e.score.toFixed(3)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {rankedPage && rankedPage.entities.length < rankedPage.total && (
                <div className="flex justify-center">
                  <Button size="sm" variant="outline" onClick={loadMoreRanked} data-testid="load-more-ranked">
                    Load more
                  </Button>
                </div>
              )}
            </Card>
          )}

          {tab === "bridges" && (
            <Card data-testid="bridges-list">
              <div className="text-xs font-medium">Structural bridges / intermediaries</div>
              <p className="text-xs text-muted-foreground">
                An entity whose removal would split the network into more connected components — a
                structural signal about network position, never a claim of wrongdoing.
              </p>
              <ul className="flex flex-col gap-1 text-xs">
                {bridges?.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedEntityId(b.id)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                      data-testid="bridge-entity-row"
                    >
                      <span className="truncate font-medium text-foreground">{b.label}</span>
                      <Badge variant="outline">{KIND_LABELS[b.kind] ?? b.kind}</Badge>
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        splits into {b.componentsAfter} components
                      </span>
                    </button>
                  </li>
                ))}
                {bridges?.length === 0 && <li className="text-muted-foreground">No structural bridges detected.</li>}
              </ul>
            </Card>
          )}

          {tab === "communities" && (
            <Card data-testid="communities-list">
              <div className="text-xs font-medium">Communities / connected groups</div>
              <p className="text-xs text-muted-foreground">
                A community is a structurally-dense group detected via modularity-based clustering — a
                connected group of entities, never a claim of a criminal organization.
              </p>
              <ul className="flex flex-col gap-1.5 text-xs">
                {communities?.map((c) => (
                  <li key={c.id} className="rounded bg-muted/40 p-2" data-testid="community-row">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">community {c.id.slice(0, 14)}…</span>
                      <Badge variant="accent">{formatCount(c.size)} members</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(c.dominantEntityTypes).map(([kind, n]) => (
                        <Badge key={kind} variant="outline">
                          {KIND_LABELS[kind] ?? kind}: {n}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.representativeEntityIds.map((id) => {
                        const label = entityOptions.find((e) => e.id === id)?.label ?? id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setSelectedEntityId(id)}
                            className="rounded bg-card px-1.5 py-0.5 text-foreground underline decoration-dotted hover:bg-muted"
                            data-testid="community-representative"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="w-80 shrink-0">
          {selectedEntityId ? (
            <AnalyticsEntityDetail key={selectedEntityId} entityId={selectedEntityId} onViewInGraph={onViewInGraph} />
          ) : (
            <Card className="text-xs text-muted-foreground">
              Select an entity to inspect its structural metrics and provenance.
            </Card>
          )}
        </div>
      </div>

      <AnalyticsPathPanel entityOptions={entityOptions} onViewInGraph={onViewInGraph} />
    </div>
  );
}
