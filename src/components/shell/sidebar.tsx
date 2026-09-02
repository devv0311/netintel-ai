"use client";

import {
  FolderOpen,
  Network,
  Clock,
  Map as MapIcon,
  BarChart3,
  MessageSquareText,
  FileText,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type NavView = "evidence" | "graph";

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

/**
 * The application sidebar. "Evidence" and "Graph" are real, clickable
 * navigation entries once their backing stage is available — the Graph
 * entry is enabled only once P5.5 graph synthesis has actually
 * succeeded (per its milestone brief: "enable the existing Graph
 * navigation entry only when graph synthesis is successfully
 * available"). Every other entry remains a disabled placeholder for a
 * later milestone.
 */
export function Sidebar({
  activeView,
  graphEnabled,
  onNavigate,
}: {
  activeView: NavView;
  graphEnabled: boolean;
  onNavigate: (view: NavView) => void;
}) {
  const sections: NavSection[] = [
    {
      label: "Investigation",
      items: [{ icon: FolderOpen, label: "Evidence", view: "evidence", enabled: true }],
    },
    {
      label: "Analysis",
      items: [
        { icon: Network, label: "Graph", view: "graph", enabled: graphEnabled },
        { icon: Clock, label: "Timeline", enabled: false },
        { icon: MapIcon, label: "Map", enabled: false },
        { icon: BarChart3, label: "Analytics", enabled: false },
      ],
    },
    {
      label: "Investigation Copilot",
      items: [{ icon: MessageSquareText, label: "Ask a Question", enabled: false }],
    },
    {
      label: "Reporting",
      items: [{ icon: FileText, label: "Dossier", enabled: false }],
    },
  ];

  return (
    <nav
      className="flex h-full w-60 shrink-0 flex-col gap-6 border-r border-border bg-card p-4"
      aria-label="Investigation navigation"
    >
      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {section.label}
          </span>
          {section.items.map((item) => {
            const isActive = item.view !== undefined && item.view === activeView;
            return (
              <button
                key={item.label}
                type="button"
                disabled={!item.enabled}
                aria-current={isActive ? "page" : undefined}
                data-testid={item.view ? `nav-${item.view}` : undefined}
                onClick={() => {
                  if (item.view && item.enabled) onNavigate(item.view);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : item.enabled
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground cursor-not-allowed opacity-60",
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
