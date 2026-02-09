import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";

const router = Router();

// Cache for exchange rates (in production, use Redis)
let cachedRates: { rates: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  GBP: 0.86,
  CHF: 0.94,
  CAD: 1.47,
  JPY: 162.5,
};

/**
 * GET /currency/rates
 * Get exchange rates relative to a base currency
 */
router.get("/rates", requireRole("READER"), async (req: TenantRequest, res) => {
  const base = (req.query.base as string) || "EUR";

  // Return cached or default rates
  const now = Date.now();
  if (cachedRates && now - cachedRates.fetchedAt < CACHE_TTL_MS) {
    return res.json({
      base,
      rates: cachedRates.rates,
      source: "cache",
      cachedAt: new Date(cachedRates.fetchedAt).toISOString(),
    });
  }

  // In production, fetch from external API like exchangerate-api.com
  // For now, use default rates
  const rates = { ...DEFAULT_RATES };

  // Rebase if not EUR
  if (base !== "EUR" && rates[base]) {
    const baseRate = rates[base];
    for (const [currency, rate] of Object.entries(rates)) {
      rates[currency] = Number((rate / baseRate).toFixed(4));
    }
  }

  cachedRates = { rates, fetchedAt: now };

  return res.json({
    base,
    rates,
    source: "default",
    cachedAt: new Date().toISOString(),
  });
});

export default router;
