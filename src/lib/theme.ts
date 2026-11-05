"use client";

// App theme: "dark" | "light". The choice persists in localStorage and is
// applied to <html data-theme> before first paint by the inline script in
// layout.tsx (so there is no flash). Everything else — the toggle, the AG
// Studio theme picker — reads through this module.

import { useSyncExternalStore } from "react";

export type AppTheme = "dark" | "light";

const KEY = "puffr:theme";
const THEME_EVENT = "puffr:theme";

export function getTheme(): AppTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — session-only theme */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

const subscribe = (cb: () => void) => {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
};

/** Current theme — re-renders subscribers when the toggle flips it. */
export function useTheme(): AppTheme {
  return useSyncExternalStore(subscribe, getTheme, () => "dark" as AppTheme);
}

// Runs in <head> before paint. Mirrors the same logic the toggle uses:
// saved choice wins, otherwise the OS preference.
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){document.documentElement.dataset.theme="dark"}})()`;
