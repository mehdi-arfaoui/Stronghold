import { CYBER_SCENARIOS, getCyberScenarioById, type CyberScenario } from "../scenarios/cyber/index.js";

export type CyberScenarioSummary = Pick<
  CyberScenario,
  | "id"
  | "name"
  | "description"
  | "defaultDurationHours"
  | "tags"
>;

export function listCyberScenarioLibrary(): CyberScenarioSummary[] {
  return CYBER_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    defaultDurationHours: scenario.defaultDurationHours,
    tags: scenario.tags,
  }));
}

export function getCyberScenarioDetails(id: string): CyberScenario | null {
  return getCyberScenarioById(id);
}

export function resolveCyberScenarioFromType(type?: string | null): CyberScenario | null {
  if (!type) return null;
  const normalized = type.toLowerCase();
  if (normalized.includes("ransom")) return getCyberScenarioById("ransomware");
  if (normalized.includes("ddos")) return getCyberScenarioById("ddos");
  if (normalized.includes("credential") || normalized.includes("identifiant")) {
    return getCyberScenarioById("credential-compromise");
  }
  if (normalized.includes("vm") || normalized.includes("virtual") || normalized.includes("destruction")) {
    return getCyberScenarioById("vm-destruction");
  }
  return null;
}
