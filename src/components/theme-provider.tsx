import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  theme: ResolvedTheme;
  setTheme: (preference: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "bellza:theme";
const LEGACY_KEY = "lumiere:theme";

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // ignore
  }
  return "system";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function persistPreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // ignore
  }
}

function applyTheme(resolved: ResolvedTheme, animate = false) {
  const root = document.documentElement;
  if (animate) root.classList.add("theme-transition");
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  if (animate) {
    window.setTimeout(() => root.classList.remove("theme-transition"), 220);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe defaults — THEME_INIT_SCRIPT already applied the correct class
  // before React hydrates, so no flash occurs with these defaults.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [theme, setThemeState] = useState<ResolvedTheme>("light");

  // Mount: read stored preference and apply to DOM WITHOUT animation.
  // This is the only place we call applyTheme for the initial state —
  // no separate hasHydrated effect that could race and reset to "light".
  useEffect(() => {
    const stored = readStoredPreference();
    const resolved = resolveTheme(stored);
    setPreferenceState(stored);
    setThemeState(resolved);
    applyTheme(resolved, false);
  }, []);

  // System media query: update live when OS preference changes.
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = resolveTheme("system");
      setThemeState(resolved);
      applyTheme(resolved, false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      theme,
      setTheme(next) {
        const resolved = resolveTheme(next);
        setPreferenceState(next);
        setThemeState(resolved);
        persistPreference(next);
        applyTheme(resolved, true); // user-triggered → animate
      },
      toggle() {
        const next: ThemePreference = theme === "dark" ? "light" : "dark";
        const resolved = resolveTheme(next);
        setPreferenceState(next);
        setThemeState(resolved);
        persistPreference(next);
        applyTheme(resolved, true); // user-triggered → animate
      },
    }),
    [preference, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
