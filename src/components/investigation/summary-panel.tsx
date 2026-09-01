import { CheckCircle2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { EvidenceCounts } from "@/lib/ingestion/types";

/**
 * The "investigation loaded" confirmation: deterministic evidence counts
 * for the ingested corpus. Shows only counts and identity — no
 * ground-truth / expected-answer information.
 */
const COUNT_TILES: { key: keyof EvidenceCounts; label: string }[] = [
  { key: "evidenceSources", label: "Evidence sources" },
  { key: "evidenceItems", label: "Evidence items" },
  { key: "communications", label: "Communications" },
  { key: "financialTransactions", label: "Financial transactions" },
  { key: "locations", label: "Locations" },
];

const ITEM_TYPE_LABELS: Record<string, string> = {
  fir: "FIRs",
  suspect_record: "Suspect records",
  alias_record: "Alias records",
  phone_record: "Phone records",
  imei_record: "IMEI records",
  vehicle_record: "Vehicle records",
  bank_account_record: "Bank account records",
  location_record: "Location records",
  cdr_event: "CDR events",
  financial_transaction_record: "Transaction records",
  witness_statement: "Witness statements",
  crime_event: "Crime events",
};

export function SummaryPanel({
  investigationName,
  corpusName,
  corpusVersion,
  ingestedAt,
  counts,
  note,
}: {
  investigationName: string;
  corpusName: string;
  corpusVersion: string;
  ingestedAt: string | null;
  counts: EvidenceCounts;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold" data-testid="investigation-loaded">
                Investigation loaded
              </span>
              <span className="text-xs text-muted-foreground">
                {investigationName}
              </span>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <ShieldAlert className="size-3" aria-hidden />
            Synthetic data only
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Corpus <span className="font-medium text-foreground">{corpusName}</span> v
          {corpusVersion}
          {ingestedAt ? ` · ingested ${formatUtc(ingestedAt)}` : ""}. Every
          record is fabricated; no real person, number, account, device, or case is
          represented.
        </p>
        {note && (
          <p
            className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            data-testid="ingest-note"
          >
            {note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {COUNT_TILES.map((tile) => {
          const value = counts[tile.key];
          return (
            <Card key={tile.key} className="gap-1 p-3">
              <span
                className="text-2xl font-semibold tabular-nums"
                data-testid={`count-${tile.key}`}
              >
                {typeof value === "number" ? formatCount(value) : "—"}
              </span>
              <span className="text-xs text-muted-foreground">{tile.label}</span>
            </Card>
          );
        })}
      </div>

      <Card>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Evidence items by type
        </span>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {Object.entries(counts.evidenceItemsByType)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([type, n]) => (
              <li key={type} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {ITEM_TYPE_LABELS[type] ?? type}
                </span>
                <span
                  className="font-medium tabular-nums"
                  data-testid={`count-type-${type}`}
                >
                  {formatCount(n)}
                </span>
              </li>
            ))}
        </ul>
      </Card>

      <Card>
        <span className="text-sm font-medium">Next steps</span>
        <p className="text-xs text-muted-foreground">
          Extraction, entity resolution, graph synthesis, analytics, corroboration, the
          Copilot, and the dossier are later milestones. Their navigation entries remain
          unavailable until then.
        </p>
      </Card>
    </div>
  );
}
