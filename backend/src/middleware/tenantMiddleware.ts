import { Request, Response, NextFunction } from "express";
import prisma from "../prismaClient";

export interface TenantRequest extends Request {
  tenantId?: string;
}

export const tenantMiddleware = async (
  req: TenantRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // laisser passer /health sans auth
    if (req.path === "/health") {
      return next();
    }

    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      console.warn("tenantMiddleware: missing x-api-key header");
      return res.status(401).json({ error: "Missing x-api-key header" });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { apiKey },
    });

    if (!tenant) {
      console.warn("tenantMiddleware: invalid API key provided");
      return res.status(403).json({ error: "Invalid API key" });
    }

    req.tenantId = tenant.id;
    next();
  } catch (error) {
    console.error("Error in tenantMiddleware:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
