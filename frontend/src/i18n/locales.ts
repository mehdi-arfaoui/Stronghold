export const LANGUAGE_STORAGE_KEY = 'stronghold-language';

export const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'it', 'zh'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_TO_LOCALE: Record<SupportedLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
  it: 'it-IT',
  zh: 'zh-CN',
};

export function normalizeLanguage(input: string | null | undefined): SupportedLanguage {
  const candidate = String(input || '').toLowerCase();
  if (candidate.startsWith('en')) return 'en';
  if (candidate.startsWith('es')) return 'es';
  if (candidate.startsWith('it')) return 'it';
  if (candidate.startsWith('zh')) return 'zh';
  return 'fr';
}

export function resolveLocale(input?: string | null): string {
  return LANGUAGE_TO_LOCALE[normalizeLanguage(input)];
}
