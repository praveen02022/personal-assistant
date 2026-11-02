"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "pos.theme";
const CHANGE_EVENT = "pos:theme-change";

/**
 * Runs inline in <head> before first paint (no flash of the wrong theme). Kept tiny and
 * dependency-free; mirrors resolveTheme() below.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||((p!=="light")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

export function resolveTheme(pref: ThemePreference, systemDark: boolean): "light" | "dark" {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

export function readPreference(storage: Pick<Storage, "getItem"> | null): ThemePreference {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

// External stores (hydration-safe: the server snapshot is used while hydrating).
function subscribePreference(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getPreference = () => readPreference(window.localStorage);
const getSystemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

type ThemeContext = { preference: ThemePreference; resolved: "light" | "dark"; setPreference: (p: ThemePreference) => void };
const Ctx = createContext<ThemeContext>({ preference: "system", resolved: "light", setPreference: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(subscribePreference, getPreference, () => "system" as const);
  const systemDark = useSyncExternalStore(subscribeSystem, getSystemDark, () => false);
  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      if (p === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      // storage unavailable (private mode): nothing to remember
    }
    document.documentElement.dataset.theme = resolveTheme(p, getSystemDark());
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
