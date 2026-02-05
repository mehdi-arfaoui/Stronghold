import type { TFunction } from "i18next";
import type { HomeStep, HomeStepId } from "../components/home/HomePage";

export const HOME_STEP_ORDER: HomeStepId[] = [
  "discovery",
  "services",
  "graph",
  "documents",
  "rag",
  "bia",
  "risks",
  "scenarios",
  "runbooks",
  "analysis",
];

export function getHomeSteps(t: TFunction): HomeStep[] {
  return HOME_STEP_ORDER.map((stepId) => ({
    id: stepId,
    title: t(`homeSteps.${stepId}.title`),
    description: t(`homeSteps.${stepId}.description`),
    actionLabel: t(`homeSteps.${stepId}.actionLabel`),
  }));
}
