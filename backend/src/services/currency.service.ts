import {
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from '../constants/market-financial-data.js';
import { appLogger } from '../utils/logger.js';

export type CurrencyRateSource = 'live' | 'cache' | 'stale_cache' | 'default';

export type CurrencyRatesSnapshot = {
  base: SupportedCurrency;
  rates: Record<SupportedCurrency, number>;
  source: CurrencyRateSource;
  cachedAt: string;
  stale: boolean;
};

type CurrencyCacheEntry = {
  ratesUsd: Record<SupportedCurrency, number>;
  fetchedAt: number;
  source: 'live' | 'default';
};

const DEFAULT_USD_TO_TARGET: Record<SupportedCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CHF: 0.88,
};

const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_500;
const LIVE_RATES_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

let cachedUsdRates: CurrencyCacheEntry | null = null;

function cloneUsdRates(rates: Record<SupportedCurrency, number>): Record<SupportedCurrency, number> {
  return {
    USD: rates.USD,
    EUR: rates.EUR,
    GBP: rates.GBP,
    CHF: rates.CHF,
  };
}

function normalizeCurrency(rawCurrency: unknown): SupportedCurrency {
  if (typeof rawCurrency === 'string') {
    const normalized = rawCurrency.toUpperCase();
    if ((SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
      return normalized as SupportedCurrency;
    }
  }
  return 'EUR';
}

function isFresh(entry: CurrencyCacheEntry, now: number): boolean {
  return now - entry.fetchedAt < FX_CACHE_TTL_MS;
}

function rebaseFromUsd(
  ratesUsd: Record<SupportedCurrency, number>,
  base: SupportedCurrency,
): Record<SupportedCurrency, number> {
  const baseRate = ratesUsd[base];
  if (!Number.isFinite(baseRate) || baseRate <= 0) {
    return cloneUsdRates(DEFAULT_USD_TO_TARGET);
  }

  const rebased = {} as Record<SupportedCurrency, number>;
  for (const currency of SUPPORTED_CURRENCIES) {
    const rate = ratesUsd[currency];
    if (!Number.isFinite(rate) || rate <= 0) {
      rebased[currency] = DEFAULT_USD_TO_TARGET[currency];
      continue;
    }
    rebased[currency] = Number((rate / baseRate).toFixed(6));
  }
  rebased[base] = 1;
  return rebased;
}

function toSnapshot(
  base: SupportedCurrency,
  entry: CurrencyCacheEntry,
  source: CurrencyRateSource,
  stale: boolean,
): CurrencyRatesSnapshot {
  return {
    base,
    rates: rebaseFromUsd(entry.ratesUsd, base),
    source,
    cachedAt: new Date(entry.fetchedAt).toISOString(),
    stale,
  };
}

async function fetchUsdRatesFromApi(): Promise<Record<SupportedCurrency, number> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(LIVE_RATES_URL, {
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { rates?: Record<string, number> };
    if (!payload.rates) return null;

    const ratesUsd = {} as Record<SupportedCurrency, number>;
    for (const currency of SUPPORTED_CURRENCIES) {
      if (currency === 'USD') {
        ratesUsd.USD = 1;
        continue;
      }
      const liveRate = Number(payload.rates[currency]);
      ratesUsd[currency] =
        Number.isFinite(liveRate) && liveRate > 0
          ? liveRate
          : DEFAULT_USD_TO_TARGET[currency];
    }
    ratesUsd.USD = 1;

    return ratesUsd;
  } catch (error) {
    appLogger.warn('currency.fx.fetch_failed', {
      reason: error instanceof Error ? error.message : 'unknown_error',
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export class CurrencyService {
  static getKnownUsdToTargetRates(): Record<SupportedCurrency, number> {
    return cloneUsdRates(cachedUsdRates?.ratesUsd ?? DEFAULT_USD_TO_TARGET);
  }

  static async getRates(baseCurrency: unknown = 'EUR'): Promise<CurrencyRatesSnapshot> {
    const base = normalizeCurrency(baseCurrency);
    const now = Date.now();
    const current = cachedUsdRates;

    if (current && isFresh(current, now)) {
      return toSnapshot(base, current, 'cache', false);
    }

    if (process.env.NODE_ENV !== 'test') {
      const liveRates = await fetchUsdRatesFromApi();
      if (liveRates) {
        cachedUsdRates = {
          ratesUsd: liveRates,
          fetchedAt: now,
          source: 'live',
        };
        return toSnapshot(base, cachedUsdRates, 'live', false);
      }
    }

    if (cachedUsdRates) {
      const stale = !isFresh(cachedUsdRates, now);
      return toSnapshot(base, cachedUsdRates, stale ? 'stale_cache' : 'cache', stale);
    }

    cachedUsdRates = {
      ratesUsd: cloneUsdRates(DEFAULT_USD_TO_TARGET),
      fetchedAt: now,
      source: 'default',
    };
    return toSnapshot(base, cachedUsdRates, 'default', false);
  }

  static convertAmount(
    amount: number,
    fromCurrency: unknown,
    toCurrency: unknown,
  ): number {
    if (!Number.isFinite(amount)) return 0;

    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    if (from === to) return amount;

    const ratesUsd = this.getKnownUsdToTargetRates();
    const fromRate = ratesUsd[from];
    const toRate = ratesUsd[to];
    if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
      return amount;
    }

    return amount * (toRate / fromRate);
  }
}

