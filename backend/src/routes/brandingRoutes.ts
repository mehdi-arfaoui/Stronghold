import { appLogger } from "../utils/logger.js";
import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { buildValidationError, parseOptionalString } from "../validation/common.js";

const router = Router();

const COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function validateColor(value: string | null | undefined, field: string, issues: any[]) {
  if (value === undefined || value === null) return;
  if (!COLOR_REGEX.test(value)) {
    issues.push({ field, message: "doit être une couleur hexadécimale (#RGB ou #RRGGBB)" });
  }
}

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const branding = await prisma.tenantBranding.findUnique({
      where: { tenantId },
    });

    return res.json({
      logoUrl: branding?.logoUrl ?? null,
      primaryColor: branding?.primaryColor ?? null,
      secondaryColor: branding?.secondaryColor ?? null,
      accentColor: branding?.accentColor ?? null,
    });
  } catch (error) {
    appLogger.error("Error in GET /branding:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/", requireRole("ADMIN"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const issues: { field: string; message: string }[] = [];
    const logoUrl = parseOptionalString(req.body.logoUrl, "logoUrl", issues, { allowNull: true });
    const primaryColor = parseOptionalString(req.body.primaryColor, "primaryColor", issues, {
      allowNull: true,
    });
    const secondaryColor = parseOptionalString(req.body.secondaryColor, "secondaryColor", issues, {
      allowNull: true,
    });
    const accentColor = parseOptionalString(req.body.accentColor, "accentColor", issues, {
      allowNull: true,
    });

    validateColor(primaryColor, "primaryColor", issues);
    validateColor(secondaryColor, "secondaryColor", issues);
    validateColor(accentColor, "accentColor", issues);

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const updateData: {
      logoUrl?: string | null;
      primaryColor?: string | null;
      secondaryColor?: string | null;
      accentColor?: string | null;
    } = {};

    if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
    if (primaryColor !== undefined) updateData.primaryColor = primaryColor;
    if (secondaryColor !== undefined) updateData.secondaryColor = secondaryColor;
    if (accentColor !== undefined) updateData.accentColor = accentColor;

    const branding = await prisma.tenantBranding.upsert({
      where: { tenantId },
      update: updateData,
      create: {
        tenantId,
        logoUrl: updateData.logoUrl ?? null,
        primaryColor: updateData.primaryColor ?? null,
        secondaryColor: updateData.secondaryColor ?? null,
        accentColor: updateData.accentColor ?? null,
      },
    });

    return res.json({
      logoUrl: branding.logoUrl ?? null,
      primaryColor: branding.primaryColor ?? null,
      secondaryColor: branding.secondaryColor ?? null,
      accentColor: branding.accentColor ?? null,
    });
  } catch (error) {
    appLogger.error("Error in PUT /branding:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
