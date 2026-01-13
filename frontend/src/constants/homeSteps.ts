import type { HomeStep, HomeStepId } from "../components/home/HomePage";
import type { Language } from "../i18n/translations";
import { HOME_STEP_CONTENT } from "../i18n/translations";

export const HOME_STEP_ORDER: HomeStepId[] = [
  "discovery",
  "documents",
  "rag",
  "bia",
  "risks",
  "scenarios",
  "runbooks",
  "analysis",
];

export function getHomeSteps(language: Language): HomeStep[] {
  return HOME_STEP_ORDER.map((stepId) => ({
    id: stepId,
    ...HOME_STEP_CONTENT[language][stepId],
  }));
}
