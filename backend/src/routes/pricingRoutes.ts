import { Router } from "express";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { normalizeAwsPriceListEntries, normalizeAwsPricingResponse } from "../clients/awsPricingClient.js";
import { normalizeAzurePricingResponse } from "../clients/azurePricingClient.js";
import { normalizeGcpPricingResponse } from "../clients/gcpPricingClient.js";
import { summarizePricing } from "../clients/pricingTypes.js";
import { fetchAwsPricingProducts } from "../services/awsPricingService.js";

const router = Router();

type ProviderKey = "aws" | "azure" | "gcp";

function resolveProvider(provider: string): ProviderKey | null {
  const normalized = provider.toLowerCase();
  if (normalized === "aws") return "aws";
  if (normalized === "azure") return "azure";
  if (normalized === "gcp") return "gcp";
  return null;
}

function normalizeByProvider(provider: ProviderKey, payload: any) {
  switch (provider) {
    case "aws":
      return normalizeAwsPricingResponse(payload);
    case "azure":
      return normalizeAzurePricingResponse(payload);
    case "gcp":
      return normalizeGcpPricingResponse(payload);
    default:
      return [];
  }
}

router.get("/providers", requireRole("READER"), (_req: TenantRequest, res) => {
  return res.json({ providers: ["aws", "azure", "gcp"] });
});

router.post("/normalize", requireRole("READER"), (req: TenantRequest, res) => {
  const providerInput = typeof req.body?.provider === "string" ? req.body.provider : "";
  const provider = resolveProvider(providerInput);
  if (!provider) {
    return res.status(400).json({ error: "Fournisseur pricing invalide (aws | azure | gcp)." });
  }

  const payload = req.body?.payload;
  if (!payload) {
    return res.status(400).json({ error: "Payload pricing manquant." });
  }

  const items = normalizeByProvider(provider, payload);
  return res.json({ provider, count: items.length, items });
});

router.post("/estimate", requireRole("READER"), (req: TenantRequest, res) => {
  const providerInput = typeof req.body?.provider === "string" ? req.body.provider : "";
  const provider = resolveProvider(providerInput);
  if (!provider) {
    return res.status(400).json({ error: "Fournisseur pricing invalide (aws | azure | gcp)." });
  }

  const payload = req.body?.payload;
  if (!payload) {
    return res.status(400).json({ error: "Payload pricing manquant." });
  }

  const items = normalizeByProvider(provider, payload);
  const summary = summarizePricing(items, {
    exchangeRate: Number(req.body?.exchangeRate ?? 1),
    discountRate: Number(req.body?.discountRate ?? 0),
    humanCostMonthly: Number(req.body?.humanCostMonthly ?? 0),
    currency: typeof req.body?.currency === "string" ? req.body.currency : undefined,
  });

  return res.json({ provider, count: items.length, items, summary });
});

router.post("/aws/products", requireRole("READER"), async (req: TenantRequest, res) => {
  const serviceCode = typeof req.body?.serviceCode === "string" ? req.body.serviceCode.trim() : "";
  if (!serviceCode) {
    return res.status(400).json({ error: "ServiceCode AWS manquant." });
  }

  const filtersInput = Array.isArray(req.body?.filters) ? req.body.filters : [];
  const filters = filtersInput
    .filter((filter: any) => filter && typeof filter.field === "string" && typeof filter.value === "string")
    .map((filter: any) => ({
      field: filter.field,
      value: filter.value,
      type: filter.type,
    }));

  try {
    const result = await fetchAwsPricingProducts({
      serviceCode,
      filters,
      maxResults: Number(req.body?.maxResults ?? 100),
      maxPages: Number(req.body?.maxPages ?? 1),
      formatVersion: typeof req.body?.formatVersion === "string" ? req.body.formatVersion : undefined,
    });

    const items = normalizeAwsPriceListEntries(result.priceList);
    const summary = summarizePricing(items, {
      exchangeRate: Number(req.body?.exchangeRate ?? 1),
      discountRate: Number(req.body?.discountRate ?? 0),
      humanCostMonthly: Number(req.body?.humanCostMonthly ?? 0),
      currency: typeof req.body?.currency === "string" ? req.body.currency : undefined,
    });

    return res.json({
      provider: "aws",
      serviceCode,
      count: items.length,
      items,
      summary,
      rawCount: result.rawCount,
      nextToken: result.nextToken ?? null,
      region: result.region,
    });
  } catch (error: any) {
    return res.status(502).json({
      error: "Impossible de joindre AWS Pricing API.",
      details: error?.message ?? "Unknown error",
    });
  }
});

export default router;
