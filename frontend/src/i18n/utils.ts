import { TRANSLATIONS, type Language } from "./translations";

export const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
];

export function getCopy(language: Language) {
  return TRANSLATIONS[language];
}

export function isLanguage(value: string): value is Language {
  return value === "fr" || value === "en";
}
