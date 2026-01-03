import type { Service, ServiceDependency } from "@prisma/client";
export type DependencyRisk = {
    id: string;
    fromServiceId: string;
    toServiceId: string;
    fromServiceName: string;
    toServiceName: string;
    dependencyType: string | null;
    riskLevel: "low" | "medium" | "high";
    risks: string[];
    recommendations: string[];
};
type ServiceWithContinuity = Service & {
    continuity?: {
        rtoHours: number;
        rpoMinutes: number;
    } | null;
};
export declare function buildDependencyRisks(services: ServiceWithContinuity[], dependencies: Array<ServiceDependency & {
    toService?: ServiceWithContinuity | null;
}>): DependencyRisk[];
export {};
//# sourceMappingURL=dependencyRiskEngine.d.ts.map