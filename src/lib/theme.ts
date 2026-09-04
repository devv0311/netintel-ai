import { resetTokenCache } from "@/lib/graph/tokens";

/**
 * The viewer's theme preference (P6.23).
 *
 * CIPHER is a dark-first operational interface — `docs/architecture` and
 * the M10.2 visual system both say so — but until now "dark-first" was
 * expressed as `@media (prefers-color-scheme: light)`, which handed the
 * light palette to every viewer on a light OS. The committed default was
 * therefore the one most people never saw.
 *
 * The theme is now an explicit choice stored per browser and applied as
 * `data-theme` on `<html>`:
 *
 *   - no stored value  -> "dark", the product default;
 *   - "light"          -> the light palette, opted into deliberately.
 *
 * Read through `useSyncExternalStore` so the server render and the first
 * client render agree on the default and the stored value is applied
 * without a hydration mismatch. The pre-paint inline script in
 * `app/layout.tsx` sets the attribute before first paint so there is no
 * flash of the wrong palette.
 *
 * Storage is a per-viewer convenience only. It never leaves the browser,
 * it is not investigation state, and every access is guarded: a browser
 * with storage disabled simply gets the default on every load.
 */
export type Theme = "dark" | "light";

export const THEME_KEY = "cipher.theme";
export const DEFAULT_THEME: Theme = "dark";

/**
 * Runs before first paint, inlined into the document head. Kept as a
 * string (and deliberately tiny) because it must execute before React
 * hydrates, and duplicated nowhere else — `THEME_KEY` is interpolated in.
 */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;

let listeners: Array<() => void> = [];

function read(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export const themeStore = {
  subscribe(cb: () => void) {
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },
  getSnapshot: read,
  getServerSnapshot(): Theme {
    return DEFAULT_THEME;
  },
  set(next: Theme) {
    resetTokenCache();
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode / storage disabled — the choice lasts for this page only */
    }
    document.documentElement.setAttribute("data-theme", next);
    for (const l of listeners) l();
  },
  toggle() {
    themeStore.set(read() === "dark" ? "light" : "dark");
  },
};
