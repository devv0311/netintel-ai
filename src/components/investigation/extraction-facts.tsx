"use client";

import { useCallback, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { ExtractedFactsPage, ExtractedFactView } from "@/lib/extraction/types";

const PAGE_SIZE = 25;

const RECORD_TYPE_LABELS: Record<string, string> = {
  entity_mention: "Entity mention",
  event_mention: "Event mention",
  relationship_mention: "Relationship mention",
  attribute_mention: "Attribute mention",
};

function renderObservedValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * A focused, paginated view of representative extracted facts
 * (this milestone's requirement #20). Fetches real pages from
 * GET /api/extraction/facts — never renders the full corpus in one
 * table. Each row shows fact type, observed value, source evidence
 * reference, full provenance, confidence, and evidence classification.
 */
export function ExtractionFacts({ initialPage }: { initialPage: ExtractedFactsPage }) {
  const [facts, setFacts] = useState<ExtractedFactView[]>(initialPage.facts);
  const [offset, setOffset] = useState(initialPage.offset + initialPage.facts.length);
  const [total, setTotal] = useState(initialPage.total);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/extraction/facts?offset=${offset}&limit=${PAGE_SIZE}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const page = (await res.json()) as ExtractedFactsPage;
      setFacts((prev) => [...prev, ...page.facts]);
      setOffset(page.offset + page.facts.length);
      setTotal(page.total);
    } finally {
      setLoading(false);
    }
  }, [offset]);

  return (
    <Card data-testid="extraction-facts">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Representative extracted facts</span>
        <span className="text-xs text-muted-foreground">
          Showing {formatCount(facts.length)} of {formatCount(total)}
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-x-auto">
        {facts.map((f) => (
          <div
            key={f.id}
            data-testid="extracted-fact"
            className="flex flex-col gap-1.5 rounded-md border border-border p-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" data-testid="fact-record-type">
                {RECORD_TYPE_LABELS[f.recordType] ?? f.recordType}
              </Badge>
              <Badge variant="accent" data-testid="fact-classification">
                {f.classification.replaceAll("_", " ")}
              </Badge>
              <span className="text-muted-foreground">{f.factType.replaceAll("_", " ")}</span>
              <span className="ml-auto text-muted-foreground">
                confidence {f.confidence.toFixed(2)}
              </span>
            </div>
            <div className="font-medium text-foreground" data-testid="fact-observed-value">
              {renderObservedValue(f.observedValue)}
            </div>
            <div className="flex flex-col gap-0.5 text-muted-foreground">
              <span data-testid="fact-source">
                Source: {f.evidenceItemType} · {f.provenance.location}
              </span>
              <span>Method: {f.provenance.method}</span>
              <span>
                Processing history: {f.provenance.processingHistory.join(" → ")}
              </span>
              <span>Extracted: {formatUtc(f.provenance.timestamp)}</span>
            </div>
          </div>
        ))}
      </div>
      {facts.length < total && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loading}
            data-testid="load-more-facts"
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
