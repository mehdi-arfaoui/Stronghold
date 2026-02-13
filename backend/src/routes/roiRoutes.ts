import { appLogger } from "../utils/logger.js";
// ============================================================
// ROI & Financial Analysis Routes
// ============================================================

import { Router } from 'express';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import { calculateROI } from '../services/roiCalculatorService.js';
import prisma from '../prismaClient.js';
import { DOWNTIME_COSTS, DATA_BREACH_COSTS, MARKET_STATS } from '../constants/market-data.js';
import { RECOVERY_STRATEGY_COSTS } from '../constants/cloud-recovery-costs.js';
import { COMPLIANCE_TAGS, getComplianceTags, calculateComplianceCoverage } from '../constants/compliance-mapping.js';

const router = Router();

// ─── GET /roi — Calculate ROI for current tenant ──────────
router.get('/', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const companySize = (req.query.companySize as string) || undefined;
    const vertical = (req.query.vertical as string) || undefined;
    const currency = (req.query.currency as string) || 'EUR';
    const customHourlyCost = req.query.hourlyCost ? Number(req.query.hourlyCost) : undefined;

    const options: Record<string, unknown> = { currency };
    if (companySize) options.companySize = companySize;
    if (vertical) options.vertical = vertical;
    if (customHourlyCost !== undefined) options.customHourlyCost = customHourlyCost;

    const roi = await calculateROI(prisma, tenantId, options as any);

    return res.json(roi);
  } catch (error) {
    appLogger.error('Error calculating ROI:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /roi/market-data — Return market data references ──────────
router.get('/market-data', (_req, res) => {
  return res.json({
    downtimeCosts: DOWNTIME_COSTS,
    dataBreach: DATA_BREACH_COSTS,
    marketStats: MARKET_STATS,
  });
});

// ─── GET /roi/recovery-strategies — Return recovery strategy costs ──────────
router.get('/recovery-strategies', (_req, res) => {
  return res.json(RECOVERY_STRATEGY_COSTS);
});

// ─── GET /roi/compliance — Return compliance mapping ──────────
router.get('/compliance', (_req, res) => {
  return res.json(COMPLIANCE_TAGS);
});

// ─── GET /roi/compliance/tags — Get tags for a specific feature ──────────
router.get('/compliance/tags', (req, res) => {
  const feature = req.query.feature as string;
  if (!feature) return res.status(400).json({ error: 'feature query parameter required' });
  return res.json(getComplianceTags(feature));
});

// ─── GET /roi/compliance/coverage — Calculate compliance coverage ──────────
router.get('/compliance/coverage', (req, res) => {
  const features = ((req.query.features as string) || '').split(',').filter(Boolean);
  return res.json(calculateComplianceCoverage(features));
});

export default router;
