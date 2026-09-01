import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function Header() {
  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-semibold text-sm">
          NI
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">NetIntel AI</span>
          <span className="text-xs text-muted-foreground">
            Investigation Workspace
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <ShieldAlert className="size-3" aria-hidden />
          Synthetic data only — not a real investigation
        </Badge>
      </div>
    </header>
  );
}
