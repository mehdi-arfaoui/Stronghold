import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { CurrencyService } from "../services/currency.service.js";

const router = Router();

/**
 * GET /currencies/rates
 * Get exchange rates relative to a base currency.
 * Uses the shared backend CurrencyService (24h cache TTL, stale fallback).
 */
router.get("/rates", requireRole("READER"), async (req: TenantRequest, res) => {
  const snapshot = await CurrencyService.getRates(req.query.base);

  return res.json({
    base: snapshot.base,
    rates: snapshot.rates,
    source: snapshot.source,
    cachedAt: snapshot.cachedAt,
    ratesDate: snapshot.cachedAt,
    stale: snapshot.stale,
  });
});

export default router;
