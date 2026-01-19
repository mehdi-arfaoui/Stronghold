import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export type CyberScenario = {
  id: string;
  name: string;
  description: string;
  incidentSteps: string[];
  impacts: string[];
  detection: string[];
  responseActions: string[];
  recoveryPlan: string[];
  defaultDurationHours: number;
  tags: string[];
};

const scenarioFiles = [
  "ransomware.json",
  "ddos.json",
  "compromission.json",
  "panne-totale.json",
  "incendie.json",
];

const baseDir = dirname(fileURLToPath(import.meta.url));

function loadScenario(fileName: string): CyberScenario {
  const raw = readFileSync(join(baseDir, fileName), "utf-8");
  return JSON.parse(raw) as CyberScenario;
}

export const CYBER_SCENARIOS: CyberScenario[] = scenarioFiles.map(loadScenario);

export function getCyberScenarioById(id: string) {
  return CYBER_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
