import type { Scenario } from '../scenarios/scenario-types.js';
import type { ServicePosture } from './service-posture-types.js';
import { populateScenarioImpact } from './finding-contextualizer.js';

export function applyScenarioImpactToServicePosture(
  posture: ServicePosture,
  scenarios: readonly Scenario[],
): ServicePosture {
  const contextualFindings = populateScenarioImpact(posture.contextualFindings, scenarios);

  return {
    ...posture,
    contextualFindings,
    services: posture.services.map((service) => ({
      ...service,
      contextualFindings: contextualFindings.filter((finding) => finding.serviceId === service.service.id),
    })),
    unassigned: {
      ...posture.unassigned,
      contextualFindings: contextualFindings.filter((finding) => finding.serviceId === null),
    },
  };
}
