"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ShieldQuestion } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type {
  EntityDetail,
  ResolvedEntitiesPage,
  ResolvedEntityView,
} from "@/lib/resolution/types";

const PAGE_SIZE = 25;

const KIND_LABELS: Record<string, string> = {
  person: "person",
  phone: "phone",
  imei: "imei",
  vehicle: "vehicle",
  bank_account: "bank account",
};

const RESOLUTION_TYPE_LABELS: Record<string, string> = {
  canonicalized_identifier: "canonicalized identifier",
  shared_identifier_merge: "shared identifier merge",
  exact_name_match: "exact name match",
  new_entity: "new entity",
  ambiguous_name_conflict: "ambiguous — not merged",
};

/**
 * The resolution-results view. For every canonical entity, shows the
 * chain this milestone must make visually obvious:
 *
 *   EXTRACTED FACT → IDENTITY RESOLUTION DECISION → CANONICAL ENTITY
 *
 * The collapsed card is the CANONICAL ENTITY; expanding it fetches and
 * shows every contributing RESOLUTION DECISION, each citing the
 * EXTRACTED FACT record it resolved. Ambiguous (non-merge) decisions
 * are shown with their conflicting candidates, never hidden. Fetches
 * real pages from GET /api/resolution/entities — never renders the
 * full entity set in one table.
 */
export function ResolutionEntities({ initialPage }: { initialPage: ResolvedEntitiesPage }) {
  const [entities, setEntities] = useState<ResolvedEntityView[]>(initialPage.entities);
  const [offset, setOffset] = useState(initialPage.offset + initialPage.entities.length);
  const [total, setTotal] = useState(initialPage.total);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/resolution/entities?offset=${offset}&limit=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const page = (await res.json()) as ResolvedEntitiesPage;
      setEntities((prev) => [...prev, ...page.entities]);
      setOffset(page.offset + page.entities.length);
      setTotal(page.total);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  return (
    <Card data-testid="resolution-entities">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Resolved entities</span>
        <span className="text-xs text-muted-foreground">
          Showing {formatCount(entities.length)} of {formatCount(total)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {entities.map((e) => (
          <EntityCard key={e.id} entity={e} />
        ))}
      </div>
      {entities.length < total && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loading}
            data-testid="load-more-entities"
            className="gap-2"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}

function EntityCard({ entity }: { entity: ResolvedEntityView }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    setExpanded((prev) => !prev);
    if (!detail && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/resolution/entities/${entity.id}`, { cache: "no-store" });
        if (res.ok) setDetail((await res.json()) as EntityDetail);
      } finally {
        setLoading(false);
      }
    }
  }, [detail, loading, entity.id]);

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-border p-2.5 text-xs"
      data-testid="resolved-entity"
      data-ambiguous={entity.hasAmbiguousDecision ? "true" : "false"}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 text-left"
        data-testid="entity-toggle"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="font-medium text-foreground" data-testid="entity-label">
          {entity.canonicalLabel}
        </span>
        <Badge variant="outline">{KIND_LABELS[entity.kind] ?? entity.kind}</Badge>
        {entity.hasAmbiguousDecision && (
          <Badge variant="outline" className="gap-1 text-foreground" data-testid="entity-ambiguous-badge">
            <ShieldQuestion className="size-3" aria-hidden />
            ambiguous — not merged
          </Badge>
        )}
        <span className="ml-auto text-muted-foreground">
          {formatCount(entity.decisionCount)} mention{entity.decisionCount === 1 ? "" : "s"} ·
          confidence {entity.confidence.toFixed(2)}
        </span>
      </button>
      {entity.aliases.length > 0 && (
        <div className="pl-6 text-muted-foreground" data-testid="entity-aliases">
          Aliases: {entity.aliases.join(", ")}
        </div>
      )}
      {expanded && (
        <div className="flex flex-col gap-1.5 border-t border-border pl-6 pt-1.5" data-testid="entity-detail">
          {loading && <span className="text-muted-foreground">Loading…</span>}
          {detail?.decisions.map((d) => (
            <div key={d.id} className="flex flex-col gap-0.5 rounded bg-muted/40 p-2" data-testid="resolution-decision">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground" data-testid="decision-source">
                  {d.extractedRecordIds.join(", ")}
                </span>
                <span aria-hidden>→</span>
                <Badge variant={d.status === "ambiguous" ? "outline" : "accent"} data-testid="decision-type">
                  {RESOLUTION_TYPE_LABELS[d.resolutionType] ?? d.resolutionType}
                </Badge>
                <span aria-hidden>→</span>
                <span className="text-muted-foreground">this entity</span>
                <span className="ml-auto text-muted-foreground">
                  classification {d.classification.replaceAll("_", " ")} · confidence{" "}
                  {d.confidence.toFixed(2)}
                </span>
              </div>
              <p className="text-muted-foreground">{d.reason}</p>
              {d.conflicts.length > 0 && (
                <ul className="list-disc pl-4 text-foreground">
                  {d.conflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <span className="text-muted-foreground">
                Provenance: {d.provenance.location} · {d.provenance.method}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
