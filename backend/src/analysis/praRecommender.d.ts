export type EnvironmentType = "cloud" | "onprem" | "hybrid";
export type Level = "low" | "medium" | "high";
export interface PRARecommendationInput {
    environment: EnvironmentType;
    maxRtoHours: number;
    maxRpoMinutes: number;
    criticality: Level;
    budgetLevel: Level;
    complexityTolerance: Level;
}
export interface PRAOptionPattern {
    id: string;
    name: string;
    description: string;
    typicalRtoRangeHours: [number, number];
    typicalRpoRangeMinutes: [number, number];
    suitableCriticality: Level[];
    costLevel: Level;
    complexityLevel: Level;
    bestForEnvironments: EnvironmentType[];
    pros: string[];
    cons: string[];
    typicalUseCases: string[];
    notRecommendedWhen: string[];
}
export interface PRARecommendation {
    patternId: string;
    name: string;
    score: number;
    suitability: "good" | "acceptable" | "poor";
    reasons: string[];
    pros: string[];
    cons: string[];
    pattern: PRAOptionPattern;
}
export declare const PRA_PATTERNS: PRAOptionPattern[];
export declare function recommendPraOptions(input: PRARecommendationInput): PRARecommendation[];
//# sourceMappingURL=praRecommender.d.ts.map