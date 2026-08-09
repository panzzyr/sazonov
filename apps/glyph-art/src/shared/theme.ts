/**
 * Theme preference, shared with the rest of sazonov.space.
 *
 * The site and both tools are separate documents on one origin, so the
 * contract between them is deliberately dumb: one localStorage key, one
 * attribute on the root element. "system" stores nothing and stamps nothing,
 * which leaves `prefers-color-scheme` in charge.
 *
 * The artwork on the canvas never follows this. It is an output, not a
 * surface — if it flipped with the UI, two people would export different
 * images from the same project.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "sazonov-theme";
export const themeOrder: Theme[] = ["light", "dark", "system"];

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private browsing can refuse storage entirely; the default still works.
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not being able to remember it is survivable; not applying it is not.
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Another tab, or the site in another tab, may change it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setTheme(readTheme());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const cycle = useCallback(() => {
    setTheme((current) => themeOrder[(themeOrder.indexOf(current) + 1) % themeOrder.length]);
  }, []);

  return { theme, setTheme, cycle };
}
