export type CriticalityLevel = "critical" | "high" | "medium" | "low";
export type DependencyEdge = {
    from: string;
    to: string;
    type: string;
};
export type PraService = {
    id: string;
    name: string;
    type: string;
    domain?: string | null;
    criticality: CriticalityLevel | string;
    rtoHours?: number | null;
    rpoMinutes?: number | null;
};
export type DrScenario = {
    id: string;
    label: string;
    description: string;
    rtoRangeHours: [number, number];
    rpoRangeMinutes: [number, number];
    cost: "low" | "medium" | "high";
    complexity: "low" | "medium" | "high";
    suitableFor: CriticalityLevel[];
    notes: string;
    source?: string;
};
export type DrRecommendation = {
    scenario: DrScenario;
    score: number;
    rationale: string[];
    justification: string;
    matchLevel: "strong" | "medium" | "weak";
};
export declare function getSuggestedDRStrategy(services: PraService[], dependencies: DependencyEdge[], targetRtoHours: number, targetRpoMinutes: number, globalCriticality: CriticalityLevel): DrRecommendation[];
export declare function summarizeScenarioForTable(rec: DrRecommendation): {
    id: string;
    label: string;
    rto: string;
    rpo: string;
    cost: "high" | "medium" | "low";
    complexity: "high" | "medium" | "low";
    description: string;
    notes: string;
};
export declare const DR_SCENARIOS: DrScenario[];
//# sourceMappingURL=drStrategyEngine.d.ts.map