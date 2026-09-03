import * as React from "react";
import { Loader2, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared empty / loading / error primitives (audit §4 — interaction
 * states). Each surface currently rolls its own centred plain-text card;
 * these standardise the treatment. Broader adoption across screens is
 * M10.3+; for M10.2 they are the shared vocabulary the shell and later
 * tasks build on.
 */

export function EmptyState({
  icon: Icon,
  title,
  detail,
  action,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: LucideIcon;
  title: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-2 p-8 text-center",
        className,
      )}
      {...props}
    >
      {Icon && (
        <span className="flex size-9 items-center justify-center rounded-full bg-surface-3 text-fg-muted">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <span className="text-sm font-medium text-fg">{title}</span>
      {detail && <span className="max-w-sm text-xs text-fg-muted">{detail}</span>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function LoadingState({
  label = "Loading…",
  className,
  ...props
}: React.ComponentProps<"div"> & { label?: string }) {
  return (
    <div
      data-slot="loading-state"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-4 text-xs text-fg-muted",
        className,
      )}
      {...props}
    >
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorState({
  code,
  message,
  onRetry,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  code?: string;
  message: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      data-slot="error-state"
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border border-l-2 border-l-red-500/70 bg-surface-2 p-4",
        className,
      )}
      {...props}
    >
      {code && <span className="text-xs font-semibold text-fg">{code}</span>}
      <span className="text-xs text-fg-muted">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 w-fit rounded-md border border-border px-2 py-1 text-xs text-fg hover:bg-surface-3"
        >
          Retry
        </button>
      )}
    </div>
  );
}
