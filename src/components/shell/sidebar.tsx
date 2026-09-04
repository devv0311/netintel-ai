"use client";

import { useSyncExternalStore } from "react";
import {
  FolderOpen,
  LayoutDashboard,
  Network,
  Clock,
  Map as MapIcon,
  BarChart3,
  ShieldCheck,
  MessageSquareText,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type NavView = "evidence" | "graph" | "analytics" | "corroboration" | "copilot" | "dossier";

interface NavItem {
  icon: typeof FolderOpen;
  label: string;
  view?: NavView;
  enabled: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const COLLAPSE_KEY = "cipher.nav.collapsed";

/**
 * The rail's collapsed state is a per-browser preference, read through
 * `useSyncExternalStore` so server and first client render agree (both
 * `false`) and the stored value is applied on the client without a
 * hydration mismatch. `localStorage.setItem` does not fire `storage` in
 * the same document, so the toggle notifies subscribers itself.
 */
let navListeners: Array<() => void> = [];

const navCollapseStore = {
  subscribe(cb: () => void) {
    navListeners.push(cb);
    return () => {
      navListeners = navListeners.filter((l) => l !== cb);
    };
  },
  getSnapshot(): boolean {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  },
  getServerSnapshot(): boolean {
    return false;
  },
  toggle() {
    const next = !navCollapseStore.getSnapshot();
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* private mode / storage disabled — the toggle is a no-op */
    }
    for (const l of navListeners) l();
  },
};

/**
 * The navigation rail (audit §2). The journey stages in order, grouped
 * Case / Analysis / Assist / Report. Each analysis entry becomes a real,
 * clickable target only once its backing stage is available — Graph once
 * P5.5 synthesis has succeeded, Analytics once P5.6 has, Corroboration
 * once P5.7 has, the Investigation Copilot once P5.8 has all of the
 * derived intelligence it grounds on, and the Dossier once P5.9 has every
 * stage it reports on. "Overview", "Timeline" and "Map" are later
 * milestones with no backing stage and stay disabled.
 *
 * The rail collapses to an icon strip (persisted per browser); every
 * button keeps a stable accessible name in both states via `aria-label`.
 */
export function Sidebar({
  activeView,
  graphEnabled,
  analyticsEnabled,
  corroborationEnabled,
  copilotEnabled,
  dossierEnabled,
  onNavigate,
}: {
  activeView: NavView;
  graphEnabled: boolean;
  analyticsEnabled: boolean;
  corroborationEnabled: boolean;
  copilotEnabled: boolean;
  dossierEnabled: boolean;
  onNavigate: (view: NavView) => void;
}) {
  const collapsed = useSyncExternalStore(
    navCollapseStore.subscribe,
    navCollapseStore.getSnapshot,
    navCollapseStore.getServerSnapshot,
  );
  const toggleCollapsed = navCollapseStore.toggle;

  const sections: NavSection[] = [
    {
      label: "Case",
      items: [
        { icon: LayoutDashboard, label: "Overview", enabled: false },
        { icon: FolderOpen, label: "Evidence", view: "evidence", enabled: true },
      ],
    },
    {
      label: "Analysis",
      items: [
        { icon: Network, label: "Graph", view: "graph", enabled: graphEnabled },
        { icon: Clock, label: "Timeline", enabled: false },
        { icon: MapIcon, label: "Map", enabled: false },
        { icon: BarChart3, label: "Analytics", view: "analytics", enabled: analyticsEnabled },
        { icon: ShieldCheck, label: "Corroboration", view: "corroboration", enabled: corroborationEnabled },
      ],
    },
    {
      label: "Assist",
      items: [{ icon: MessageSquareText, label: "Ask a Question", view: "copilot", enabled: copilotEnabled }],
    },
    {
      label: "Report",
      items: [{ icon: FileText, label: "Dossier", view: "dossier", enabled: dossierEnabled }],
    },
  ];

  return (
    <nav
      className={cn(
        "flex h-full shrink-0 flex-col gap-5 border-r border-border bg-surface-2 p-3 transition-[width] duration-150",
        collapsed ? "w-14" : "w-60",
      )}
      aria-label="Investigation navigation"
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        data-testid="nav-collapse-toggle"
        className="flex items-center gap-2 self-end rounded-md p-1.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden />
        )}
      </button>

      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <span
            className={cn(
              "px-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint",
              collapsed && "sr-only",
            )}
          >
            {section.label}
          </span>
          {section.items.map((item) => {
            const isActive = item.view !== undefined && item.view === activeView;
            return (
              <button
                key={item.label}
                type="button"
                disabled={!item.enabled}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                data-testid={item.view ? `nav-${item.view}` : undefined}
                onClick={() => {
                  if (item.view && item.enabled) onNavigate(item.view);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  collapsed && "justify-center",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : item.enabled
                      ? "text-fg hover:bg-surface-3"
                      : "text-fg-faint cursor-not-allowed opacity-60",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                <span className={cn(collapsed && "sr-only")}>{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
