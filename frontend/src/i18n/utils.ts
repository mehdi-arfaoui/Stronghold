import type { TFunction } from "i18next";
import { SUPPORTED_LANGUAGES, type Language } from "./languages";

export function getLanguageOptions(t: TFunction) {
  return SUPPORTED_LANGUAGES.map((language) => ({
    value: language,
    label: t(`languageOptions.${language}`),
  }));
}

export function isLanguage(value: string): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}
