"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type {
  CorroborationClassification,
  CorroborationFindingsPage,
  CorroborationFindingType,
  CorroborationFindingView,
  CorroborationState,
  EntityPairOverlapView,
} from "@/lib/corroboration/types";

import { CorroborationTimeline } from "./corroboration-timeline";
import { Inspector } from "./inspector/inspector";
import type { InspectorTarget } from "./inspector/types";

type Tab = "spatial" | "temporal" | "overlaps" | "contradictions" | "pairs";
type ClassFilter = "all" | CorroborationClassification;

const TAB_QUERY: Record<Exclude<Tab, "pairs">, { kind?: string; type?: CorroborationFindingType }> = {
  spatial: { kind: "spatial" },
  temporal: { type: "temporal_co_occurrence" },
  overlaps: { type: "repeated_spatiotemporal_overlap" },
  contradictions: { type: "spatiotemporal_contradiction" },
};

const FINDING_TYPE_LABELS: Record<CorroborationFindingType, string> = {
  spatial_co_location: "Co-location",
  spatial_proximity: "Proximity",
  temporal_co_occurrence: "Temporal co-occurrence",
  repeated_spatiotemporal_overlap: "Repeated overlap",
  spatiotemporal_contradiction: "Contradiction",
};

const CLASS_LABELS: Record<CorroborationClassification, string> = {
  corroborated_fact: "Corroborated Fact",
  algorithmic_signal: "Algorithmic Signal",
};

/**
 * The spatial/temporal corroboration screen (P5.7): an investigator's
 * workspace over persisted corroboration findings. Spatial / temporal /
 * repeated-overlap / contradiction views, an entity-pair overlap
 * roll-up, a classification filter (corroborated fact vs algorithmic
 * signal), a timeline for the temporal views, side-by-side conflicting
 * placements for contradictions, and a detail panel that always shows
 * the finding's classification, method, confidence, the structured
 * metric that produced it, and the full provenance chain plus the exact
 * source evidence-item and observable-record ids. Never presents a
 * derived overlap as an observed fact; never claims contact or
 * causation. Links back to the Graph screen via `onViewInGraph`.
 */
export function CorroborationScreen({
  initialState,
  focusEntityId,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
}: {
  initialState: CorroborationState;
  /** The shell's persistent focused entity — filters every tab to that entity's overlaps when one is set. */
  focusEntityId: string | null;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(focusEntityId ? "spatial" : "pairs");
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [pairFilter, setPairFilter] = useState<{ id: string; label: string } | null>(
    focusEntityId ? { id: focusEntityId, label: "selected entity" } : null,
  );
  const [findings, setFindings] = useState<CorroborationFindingView[]>([]);
  const [total, setTotal] = useState(0);
  const [pairs, setPairs] = useState<EntityPairOverlapView[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Entity / relationship targets reached from inside the Inspector; when
  // null the Inspector shows the selected finding.
  const [inspectorOverride, setInspectorOverride] = useState<InspectorTarget | null>(null);

  const synthesized = initialState.status === "synthesized";
  const pairFilterId = pairFilter?.id ?? null;
  const isFindingsTab = tab !== "pairs";

  useEffect(() => {
    if (!synthesized || !isFindingsTab) return;
    let cancelled = false;
    const params = new URLSearchParams({ limit: "200" });
    const q = TAB_QUERY[tab as Exclude<Tab, "pairs">];
    if (q.kind) params.set("kind", q.kind);
    if (q.type) params.set("type", q.type);
    if (classFilter !== "all") params.set("classification", classFilter);
    if (pairFilterId) params.set("entityId", pairFilterId);
    void fetch(`/api/corroboration/findings?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CorroborationFindingsPage>) : null))
      .then((page) => {
        if (cancelled || !page) return;
        setFindings(page.findings);
        setTotal(page.total);
        setSelectedId((prev) =>
          prev && page.findings.some((f) => f.id === prev) ? prev : (page.findings[0]?.id ?? null),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [synthesized, tab, isFindingsTab, classFilter, pairFilterId]);

  useEffect(() => {
    if (!synthesized) return;
    let cancelled = false;
    void fetch("/api/corroboration/pairs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { pairs: EntityPairOverlapView[] } | null) => {
        if (!cancelled && data) setPairs(data.pairs);
      });
    return () => {
      cancelled = true;
    };
  }, [synthesized]);

  // When another surface changes the focused entity, filter every tab to
  // it (render-phase prop reconciliation, not an effect).
  const [syncedFocus, setSyncedFocus] = useState(focusEntityId);
  if (focusEntityId !== syncedFocus) {
    setSyncedFocus(focusEntityId);
    if (focusEntityId) {
      setPairFilter({ id: focusEntityId, label: "selected entity" });
      setTab((t) => (t === "pairs" ? "spatial" : t));
    }
  }

  const selectFinding = (id: string) => {
    setSelectedId(id);
    setInspectorOverride(null);
  };

  if (initialState.status !== "synthesized") {
    return (
      <Card
        className="mx-auto mt-8 max-w-md text-center text-sm text-muted-foreground"
        data-testid="corroboration-unavailable"
      >
        Spatial/temporal corroboration has not been run yet. Return to Evidence and run corroboration once topology
        analytics has completed.
      </Card>
    );
  }

  const { counts } = initialState.summary;
  const selected = findings.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="corroboration-screen">
      <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Synthetic data only. Each finding below is a <strong>Corroborated Fact</strong> (independent evidence agrees)
          or an <strong>Algorithmic Signal</strong> (a derived spatial/temporal pattern) — never an observed fact, and
          never a claim that two entities were together or that timing implies contact.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="corroboration-overview">
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums">{formatCount(counts.activityEvents)}</span>
          <span className="text-xs text-muted-foreground">Activity events compared</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-overview-corroborated">
            {formatCount(counts.corroboratedFacts)}
          </span>
          <span className="text-xs text-muted-foreground">Corroborated facts</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-overview-algorithmic">
            {formatCount(counts.algorithmicSignals)}
          </span>
          <span className="text-xs text-muted-foreground">Algorithmic signals</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums">{formatCount(counts.contradictions)}</span>
          <span className="text-xs text-muted-foreground">Contradictions</span>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="corroboration-class-filter">
        <span className="font-medium">Show:</span>
        {(["all", "corroborated_fact", "algorithmic_signal"] as ClassFilter[]).map((c) => (
          <Button
            key={c}
            size="sm"
            variant={classFilter === c ? "default" : "outline"}
            onClick={() => setClassFilter(c)}
            data-testid={`class-filter-${c}`}
          >
            {c === "all" ? "All findings" : CLASS_LABELS[c]}
          </Button>
        ))}
        {pairFilter && (
          <Button size="sm" variant="outline" onClick={() => setPairFilter(null)} data-testid="clear-pair-filter">
            Clear pair filter: {pairFilter.label} ✕
          </Button>
        )}
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-1.5 text-xs" data-testid="corroboration-tabs">
            {(
              [
                ["pairs", "Entity pairs"],
                ["spatial", "Spatial"],
                ["temporal", "Temporal"],
                ["overlaps", "Repeated overlaps"],
                ["contradictions", "Contradictions"],
              ] as [Tab, string][]
            ).map(([t, labelText]) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "default" : "outline"}
                onClick={() => setTab(t)}
                data-testid={`tab-${t}`}
              >
                {labelText}
              </Button>
            ))}
          </div>

          {tab === "pairs" ? (
            <Card data-testid="corroboration-pairs-list">
              <div className="text-xs font-medium">Entity pairs with repeated spatial / temporal overlap</div>
              <p className="text-xs text-muted-foreground">
                How often each pair shares a location or a time window across the corpus — strongest corroboration
                first. Selecting a pair filters every tab to just that pair.
              </p>
              <ul className="flex flex-col gap-1 text-xs">
                {pairs?.slice(0, 50).map((p) => (
                  <li key={`${p.entityAId}|${p.entityBId}`}>
                    <button
                      type="button"
                      data-testid="corroboration-pair-row"
                      onClick={() => {
                        setPairFilter({ id: p.entityAId, label: `${p.entityALabel} ↔ ${p.entityBLabel}` });
                        setTab("spatial");
                      }}
                      className="flex w-full flex-wrap items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                    >
                      <span className="truncate font-medium text-foreground">
                        {p.entityALabel} ↔ {p.entityBLabel}
                      </span>
                      {p.corroboratedFacts > 0 && (
                        <Badge variant="accent">{p.corroboratedFacts} corroborated</Badge>
                      )}
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {p.spatialFindings} spatial · {p.repeatedOverlaps} overlaps
                        {p.contradictions > 0 ? ` · ${p.contradictions} conflict` : ""}
                      </span>
                    </button>
                  </li>
                ))}
                {pairs && pairs.length > 50 && (
                  <li className="text-[10px] text-muted-foreground">
                    +{pairs.length - 50} more pairs — use the classification filter or a spatial/temporal tab to narrow.
                  </li>
                )}
                {pairs?.length === 0 && <li className="text-muted-foreground">No entity pairs overlap.</li>}
              </ul>
            </Card>
          ) : (
            <Card data-testid="corroboration-findings-list">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {tab === "spatial"
                    ? "Spatial findings"
                    : tab === "temporal"
                      ? "Temporal co-occurrences"
                      : tab === "overlaps"
                        ? "Repeated spatiotemporal overlaps"
                        : "Spatiotemporal contradictions"}
                </span>
                <span className="text-muted-foreground">
                  {`${formatCount(findings.length)} of ${formatCount(total)}`}
                </span>
              </div>

              {(tab === "temporal" || tab === "overlaps") && findings.length > 0 && (
                <CorroborationTimeline findings={findings} selectedId={selectedId} onSelect={selectFinding} />
              )}

              {tab === "contradictions" ? (
                <ul className="flex flex-col gap-2 text-xs">
                  {findings.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        data-testid="contradiction-card"
                        onClick={() => selectFinding(f.id)}
                        className={`w-full rounded border p-2 text-left hover:bg-muted ${
                          selectedId === f.id ? "border-accent" : "border-border"
                        }`}
                      >
                        <div className="font-medium text-foreground">{f.entities[0]?.label ?? "—"}</div>
                        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                          <span className="rounded bg-muted/60 px-1.5 py-1">
                            {f.locations[0]?.label ?? "—"}
                            <span className="block text-[10px] text-muted-foreground">{f.window?.start}</span>
                          </span>
                          <span className="text-muted-foreground" aria-hidden>
                            ⇄
                          </span>
                          <span className="rounded bg-muted/60 px-1.5 py-1 text-right">
                            {f.locations[1]?.label ?? "—"}
                            <span className="block text-[10px] text-muted-foreground">{f.window?.end}</span>
                          </span>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          implied speed{" "}
                          {f.value.impliedSpeedMps === null ? "instantaneous" : `${String(f.value.impliedSpeedMps)} m/s`} ·{" "}
                          {String(f.value.distanceMeters)} m in {String(f.value.elapsedSeconds)} s
                        </div>
                      </button>
                    </li>
                  ))}
                  {findings.length === 0 && (
                    <li className="text-muted-foreground">No contradictions detected — checked, none found.</li>
                  )}
                </ul>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {findings.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        data-testid="corroboration-finding-row"
                        data-finding-id={f.id}
                        onClick={() => selectFinding(f.id)}
                        className={`flex w-full flex-wrap items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted ${
                          selectedId === f.id ? "bg-muted" : ""
                        }`}
                      >
                        <Badge variant={f.classification === "corroborated_fact" ? "accent" : "outline"}>
                          {f.classification === "corroborated_fact" ? "corroborated" : "signal"}
                        </Badge>
                        <span className="truncate font-medium text-foreground">
                          {f.entities.length > 0
                            ? f.entities.map((e) => e.label).join(" ↔ ")
                            : f.locations.map((l) => l.label).join(" ~ ")}
                        </span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{FINDING_TYPE_LABELS[f.findingType]}</span>
                      </button>
                    </li>
                  ))}
                  {findings.length === 0 && (
                    <li className="text-muted-foreground">No findings of this kind for the current filter.</li>
                  )}
                </ul>
              )}
            </Card>
          )}
        </div>

        <Inspector
          target={inspectorOverride ?? (selected ? { kind: "finding", id: selected.id, finding: selected } : null)}
          context="corroboration"
          nav={{
            viewInGraph: onViewInGraph,
            viewInAnalytics: onViewInAnalytics,
            viewInCorroboration: onViewInCorroboration,
          }}
          onClear={() => {
            setSelectedId(null);
            setInspectorOverride(null);
          }}
          onSelectEntity={(id) => setInspectorOverride({ kind: "entity", id })}
          onSelectRelationship={(id) => setInspectorOverride({ kind: "relationship", id })}
        />
      </div>
    </div>
  );
}
