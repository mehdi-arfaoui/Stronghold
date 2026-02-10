import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";

const router = Router();

// Cache for exchange rates with 1-hour TTL
let cachedRates: { rates: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const DEFAULT_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.86,
  CHF: 0.94,
  CAD: 1.47,
  JPY: 162.5,
};

async function fetchLiveRates(base: string): Promise<Record<string, number> | null> {
  try {
    const response = await fetch(
      `https://api.exchangerate-api.com/v4/latest/${base}`
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { rates?: Record<string, number> };
    if (!data.rates) return null;

    // Only keep currencies we support
    const supported = Object.keys(DEFAULT_RATES);
    const filtered: Record<string, number> = {};
    for (const key of supported) {
      if (data.rates[key] !== undefined) {
        filtered[key] = data.rates[key];
      }
    }
    return Object.keys(filtered).length > 0 ? filtered : null;
  } catch {
    return null;
  }
}

/**
 * GET /currencies/rates
 * Get exchange rates relative to a base currency.
 * Attempts to fetch live rates with a 1-hour cache TTL, falls back to defaults.
 */
router.get("/rates", requireRole("READER"), async (req: TenantRequest, res) => {
  const base = (req.query.base as string) || "EUR";

  const now = Date.now();

  // Return cached rates if still fresh
  if (cachedRates && now - cachedRates.fetchedAt < CACHE_TTL_MS) {
    return res.json({
      base,
      rates: cachedRates.rates,
      source: "cache",
      cachedAt: new Date(cachedRates.fetchedAt).toISOString(),
    });
  }

  // Attempt to fetch live rates
  const liveRates = await fetchLiveRates(base);
  let rates: Record<string, number>;
  let source: string;

  if (liveRates) {
    rates = liveRates;
    source = "live";
  } else {
    // Fallback to default rates
    rates = { ...DEFAULT_RATES };

    // Rebase if not EUR
    if (base !== "EUR" && rates[base]) {
      const baseRate = rates[base];
      for (const [currency, rate] of Object.entries(rates)) {
        rates[currency] = Number((rate / baseRate).toFixed(4));
      }
    }
    source = "default";
  }

  cachedRates = { rates, fetchedAt: now };

  return res.json({
    base,
    rates,
    source,
    cachedAt: new Date().toISOString(),
  });
});

export default router;
