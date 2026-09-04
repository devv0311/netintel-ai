"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { themeStore } from "@/lib/theme";

/**
 * Switches between the committed dark operational palette and the light
 * variant. A per-viewer display preference only: it changes no
 * investigation state, is never sent anywhere, and the label always
 * states what pressing it will do.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={themeStore.toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      data-testid="theme-toggle"
      className="rounded-md border border-border p-1.5 text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {theme === "dark" ? (
        <Sun className="size-3.5" aria-hidden />
      ) : (
        <Moon className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
