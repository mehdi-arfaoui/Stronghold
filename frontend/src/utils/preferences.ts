import type { Language } from "../i18n/translations";

export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "stronghold-theme";
const LANGUAGE_STORAGE_KEY = "stronghold-language";

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return null;
}

export function getStoredLanguage(): Language | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "fr" || stored === "en") return stored;
  return null;
}

export function setStoredTheme(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function setStoredLanguage(language: Language) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function getDefaultTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getDefaultLanguage(): Language {
  if (typeof navigator === "undefined") return "fr";
  const candidate = navigator.language.toLowerCase();
  return candidate.startsWith("en") ? "en" : "fr";
}
