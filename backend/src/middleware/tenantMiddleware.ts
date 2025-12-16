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
      return res.status(401).json({ error: "Missing x-api-key header" });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { apiKey },
    });

    if (!tenant) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    req.tenantId = tenant.id;
    next();
  } catch (error) {
    console.error("Error in tenantMiddleware:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
