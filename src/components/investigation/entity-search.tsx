"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

import { KIND_LABELS, KIND_VAR } from "@/lib/graph/tokens";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResolvedEntitiesPage, ResolvedEntityView } from "@/lib/resolution/types";

/**
 * Entity search — the investigator's entry point into a case (P6.23).
 *
 * It searches the canonical entities entity resolution actually produced,
 * fetched from the existing `GET /api/resolution/entities` endpoint. It is
 * NOT a search of the evidence corpus, of a register, or of the web, and
 * it deliberately says which set it covers: a search box that implies more
 * reach than it has is the easiest way for an investigative tool to
 * mislead.
 *
 * Matching is a plain case-insensitive substring test over the canonical
 * label, the aliases resolution recorded, and the entity kind. There is no
 * fuzzy matching, no ranking model and no embedding here — this is a
 * lookup over resolved identities, not a second resolver, and it must
 * never suggest that two entities are the same when the resolver did not
 * say so.
 */

/** Server caps `limit` at 100; five pages is the most this will pull. */
const PAGE = 100;
const MAX_LOADED = 500;
const MAX_RESULTS = 8;

type LoadState = "idle" | "loading" | "ready" | "error";

export function EntitySearch({
  variant = "bar",
  available,
  totalEntities,
  onSelect,
  className,
}: {
  /** `hero` is the dashboard's primary entry; `bar` is the persistent command-bar field. */
  variant?: "hero" | "bar";
  /** False until entity resolution has produced entities to search. */
  available: boolean;
  totalEntities: number;
  onSelect: (entityId: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [entities, setEntities] = useState<ResolvedEntityView[]>([]);
  const [total, setTotal] = useState(totalEntities);
  const [state, setState] = useState<LoadState>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const load = useCallback(async () => {
    setState("loading");
    try {
      const collected: ResolvedEntityView[] = [];
      let offset = 0;
      let reported = totalEntities;
      for (;;) {
        const res = await fetch(`/api/resolution/entities?offset=${offset}&limit=${PAGE}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setState("error");
          return;
        }
        const page = (await res.json()) as ResolvedEntitiesPage;
        collected.push(...page.entities);
        reported = page.total;
        offset = page.offset + page.entities.length;
        if (page.entities.length === 0 || offset >= page.total || collected.length >= MAX_LOADED) break;
      }
      setEntities(collected);
      setTotal(reported);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [totalEntities]);

  // Loaded once, on first interaction — never on mount, so a screen that
  // merely renders the field does not pull the entity set.
  const ensureLoaded = useCallback(() => {
    if (state === "idle") void load();
  }, [load, state]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = entities.filter(
      (e) =>
        e.canonicalLabel.toLowerCase().includes(q) ||
        e.kind.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)),
    );
    // Label matches first, then alias/kind matches; stable and explainable.
    hits.sort((a, b) => {
      const al = a.canonicalLabel.toLowerCase().includes(q) ? 0 : 1;
      const bl = b.canonicalLabel.toLowerCase().includes(q) ? 0 : 1;
      if (al !== bl) return al - bl;
      return a.canonicalLabel.localeCompare(b.canonicalLabel);
    });
    return hits.slice(0, MAX_RESULTS);
  }, [entities, query]);

  const choose = useCallback(
    (entity: ResolvedEntityView) => {
      setOpen(false);
      setQuery("");
      onSelect(entity.id);
    },
    [onSelect],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[Math.min(active, results.length - 1)];
      if (picked) choose(picked);
    }
  };

  const hero = variant === "hero";
  const showPanel = open && (query.trim().length > 0 || state === "loading" || state === "error");

  return (
    <div ref={rootRef} className={cn("relative", hero ? "w-full" : "w-full max-w-xs", className)}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border bg-surface-1 transition-colors focus-within:border-border-strong",
          hero ? "border-border-strong px-3 py-2.5" : "border-border px-2 py-1.5",
          !available && "opacity-60",
        )}
      >
        <Search className={cn("shrink-0 text-fg-faint", hero ? "size-4" : "size-3.5")} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={!available}
          value={query}
          placeholder={available ? "Search resolved entities…" : "Run entity resolution to search"}
          data-testid={hero ? "entity-search-hero" : "entity-search"}
          onFocus={() => {
            ensureLoaded();
            setOpen(true);
          }}
          onChange={(e) => {
            ensureLoaded();
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint",
            hero ? "text-sm" : "text-xs",
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
        {state === "loading" && <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-faint" aria-hidden />}
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="rounded p-0.5 text-fg-faint hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {hero && (
        <p className="mt-1.5 text-xs text-fg-faint">
          {available
            ? `Searches the ${formatCount(total)} canonical entities produced by entity resolution — not the evidence corpus, and not any external register.`
            : "Entity resolution has not produced any entities yet. Run it from Evidence."}
        </p>
      )}

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          data-testid="entity-search-results"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border-strong bg-surface-2 shadow-lg"
        >
          {state === "error" && (
            <p className="px-3 py-2.5 text-xs text-fg-muted">
              Could not load resolved entities. The case may not be resolved yet.
            </p>
          )}
          {state !== "error" && results.length === 0 && (
            <p className="px-3 py-2.5 text-xs text-fg-muted">
              {state === "loading"
                ? "Loading resolved entities…"
                : `No resolved entity matches “${query.trim()}”.`}
            </p>
          )}
          {results.map((e, i) => (
            <button
              key={e.id}
              type="button"
              role="option"
              aria-selected={i === active}
              data-testid="entity-search-result"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(e)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                i === active ? "bg-surface-3" : "hover:bg-surface-3/60",
              )}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(${KIND_VAR[e.kind] ?? KIND_VAR.other})` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-fg">{e.canonicalLabel}</span>
                {e.aliases.length > 0 && (
                  <span className="block truncate text-[11px] text-fg-faint">
                    also known as {e.aliases.slice(0, 3).join(", ")}
                    {e.aliases.length > 3 ? ` +${e.aliases.length - 3}` : ""}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg-faint">
                {KIND_LABELS[e.kind] ?? e.kind}
              </span>
            </button>
          ))}
          {state === "ready" && total > entities.length && (
            <p className="border-t border-border px-3 py-1.5 text-[11px] text-fg-faint">
              Searching the first {formatCount(entities.length)} of {formatCount(total)} resolved entities.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
