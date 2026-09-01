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

const NAV_SECTIONS = [
  {
    label: "Investigation",
    items: [{ icon: FolderOpen, label: "Evidence", active: true }],
  },
  {
    label: "Analysis",
    items: [
      { icon: Network, label: "Graph", active: false },
      { icon: Clock, label: "Timeline", active: false },
      { icon: MapIcon, label: "Map", active: false },
      { icon: BarChart3, label: "Analytics", active: false },
    ],
  },
  {
    label: "Investigation Copilot",
    items: [
      { icon: MessageSquareText, label: "Ask a Question", active: false },
    ],
  },
  {
    label: "Reporting",
    items: [{ icon: FileText, label: "Dossier", active: false }],
  },
] as const;

export function Sidebar() {
  return (
    <nav
      className="flex h-full w-60 shrink-0 flex-col gap-6 border-r border-border bg-card p-4"
      aria-label="Investigation navigation"
    >
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <span className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {section.label}
          </span>
          {section.items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={!item.active}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors",
                item.active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground cursor-not-allowed opacity-60",
              )}
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
