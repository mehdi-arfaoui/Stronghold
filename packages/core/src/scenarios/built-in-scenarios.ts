import type { InfraNodeAttrs } from '../types/infrastructure.js';
import { getAvailabilityZone, getMetadata, readString } from '../graph/analysis-helpers.js';
import { normalizeEdgeType } from '../services/service-utils.js';
import type {
  GenerateBuiltInScenariosInput,
  GeneratedScenarioSet,
  Scenario,
} from './scenario-types.js';
import {
  selectByAZ,
  selectByNodeId,
  selectByRegion,
  selectDatastores,
} from './selection-helpers.js';

const DEFAULT_SCENARIO_LIMIT = 20;
const DEFAULT_SPOF_LIMIT = 10;

const CRITICALITY_PRIORITY = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
} as const;

export function generateBuiltInScenarios(
  input: GenerateBuiltInScenariosInput,
): GeneratedScenarioSet {
  if (input.nodes.length === 0) {
    return {
      scenarios: [],
      defaultScenarioIds: [],
    };
  }

  const azScenarios: Scenario[] = collectAvailabilityZones(input.nodes).map((az) => ({
    id: `az-failure-${slug(az)}`,
    name: `AZ failure - ${az}`,
    description: `Removes every resource placed in ${az} and evaluates the downstream disruption impact.`,
    type: 'az_failure',
    disruption: {
      affectedNodes: selectByAZ(input.nodes, az),
      selectionCriteria: `All resources in ${az}`,
    },
  }));

  const regions = collectRegions(input.nodes);
  const regionScenarios: Scenario[] =
    regions.length > 1
      ? regions.map((region) => ({
          id: `region-failure-${slug(region)}`,
          name: `Region failure - ${region}`,
          description: `Removes every scanned resource in ${region} and evaluates whether services still have a recovery path.`,
          type: 'region_failure',
          disruption: {
            affectedNodes: selectByRegion(input.nodes, region),
            selectionCriteria: `All resources in ${region}`,
          },
        }))
      : [];

  const spofScenarios = input.analysis.spofs
    .slice()
    .sort(
      (left, right) =>
        right.blastRadius - left.blastRadius ||
        left.nodeName.localeCompare(right.nodeName) ||
        left.nodeId.localeCompare(right.nodeId),
    )
    .map<Scenario>((spof) => ({
      id: `spof-${slug(spof.nodeId)}`,
      name: `SPOF failure - ${spof.nodeName}`,
      description: `Models the loss of ${spof.nodeName} and measures the dependent resources that also become unavailable.`,
      type: 'node_failure',
      disruption: {
        affectedNodes: selectByNodeId(spof.nodeId),
        selectionCriteria: `${spof.nodeName} fails`,
      },
    }));

  const dataCorruptionScenarios = input.services
    .filter((service) =>
      service.resources.some((resource) =>
        selectDatastores(input.nodes, service.id, input.services).includes(resource.nodeId),
      ),
    )
    .slice()
    .sort(
      (left, right) =>
        CRITICALITY_PRIORITY[right.criticality] - CRITICALITY_PRIORITY[left.criticality] ||
        left.name.localeCompare(right.name),
    )
    .map<Scenario>((service) => ({
      id: `data-corruption-${slug(service.id)}`,
      name: `Data corruption - ${service.name}`,
      description: `Models datastore corruption in ${service.name}; recovery requires a restore path rather than simple failover.`,
      type: 'data_corruption',
      disruption: {
        affectedNodes: selectDatastores(input.nodes, service.id, input.services),
        selectionCriteria: `All datastores in service "${service.name}"`,
      },
    }));

  const scenarios = [
    ...azScenarios,
    ...regionScenarios,
    ...spofScenarios,
    ...dataCorruptionScenarios,
  ];

  const defaultScenarioIds = [
    ...azScenarios.map((scenario) => scenario.id),
    ...dataCorruptionScenarios.map((scenario) => scenario.id),
    ...regionScenarios.map((scenario) => scenario.id),
    ...spofScenarios.slice(0, DEFAULT_SPOF_LIMIT).map((scenario) => scenario.id),
  ].slice(0, DEFAULT_SCENARIO_LIMIT);

  return {
    scenarios,
    defaultScenarioIds,
  };
}

function collectAvailabilityZones(nodes: readonly InfraNodeAttrs[]): readonly string[] {
  return Array.from(
    new Set(
      nodes
        .map((node) => getAvailabilityZone(node))
        .filter((zone): zone is string => typeof zone === 'string' && zone.length > 0),
    ),
  ).sort();
}

function collectRegions(nodes: readonly InfraNodeAttrs[]): readonly string[] {
  return Array.from(
    new Set(
      nodes
        .map((node) => node.region ?? readString(getMetadata(node).region))
        .filter((region): region is string => typeof region === 'string' && region.length > 0),
    ),
  ).sort();
}

function slug(value: string): string {
  return normalizeEdgeType(value);
}
