import { Request, Response, NextFunction } from "express";
import type { ApiRole } from "@prisma/client";
export interface TenantRequest extends Request {
    tenantId?: string;
    apiKeyId?: string;
    apiRole?: ApiRole;
    correlationId?: string;
}
export declare const tenantMiddleware: (req: TenantRequest, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
export declare function requireRole(required: ApiRole): (req: TenantRequest, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
//# sourceMappingURL=tenantMiddleware.d.ts.map