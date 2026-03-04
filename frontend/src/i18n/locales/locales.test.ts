import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type LocaleValue = string | Record<string, LocaleValue>;

const localeFiles = ['fr.json', 'en.json', 'es.json', 'it.json', 'zh.json'] as const;

function readLocale(file: (typeof localeFiles)[number]) {
  const filePath = resolve(process.cwd(), 'src', 'i18n', 'locales', file);
  const buffer = readFileSync(filePath);
  const text = buffer.toString('utf8');

  return {
    buffer,
    text,
    json: JSON.parse(text) as Record<string, LocaleValue>,
  };
}

function collectStrings(value: LocaleValue): string[] {
  if (typeof value === 'string') return [value];
  return Object.values(value).flatMap((entry) => collectStrings(entry));
}

describe('locale files', () => {
  it.each(localeFiles)('stores %s as UTF-8 JSON without BOM or mojibake', (file) => {
    const { buffer, json, text } = readLocale(file);
    const values = collectStrings(json);
    const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;

    expect(hasBom).toBe(false);
    expect(text.startsWith('{')).toBe(true);
    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      expect(value).not.toMatch(/Ãƒ.|Ã‚.|Ã¢â‚¬|Ã¢â‚¬â„¢|Ã¢â‚¬Å“|Ã¢â‚¬\u009d|ï¿½/);
    }
  });

  it('keeps the known French labels readable', () => {
    const { json } = readLocale('fr.json');

    expect(json.common).toMatchObject({
      create: 'Créer',
      reset: 'Réinitialiser',
      cost: 'Coût',
      details: 'Détails',
      copied: 'Copié',
      logout: 'Se déconnecter',
      enabled: 'Activé',
    });
  });
});
