import fs from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import type { InfraNode } from '../validation/validation-types.js';
import { collectNodeReferences } from '../validation/validation-node-utils.js';
import type { LoadedManualServices, ManualServiceDefinition, Service } from './service-types.js';
import { classifyResourceRole, slugifyServiceId } from './service-utils.js';

type ServicesConfigRecord = Record<string, unknown>;

export const SERVICES_FILE_VERSION = 1;
export const DEFAULT_SERVICES_FILE_PATH = path.join('.stronghold', 'services.yml');

export function loadManualServices(
  nodes: readonly InfraNode[],
  options: {
    readonly filePath?: string;
    readonly previousAssignments?: readonly Service[];
  } = {},
): LoadedManualServices | null {
  const filePath = path.resolve(options.filePath ?? DEFAULT_SERVICES_FILE_PATH);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    return parseManualServices(contents, nodes, {
      filePath,
      previousAssignments: options.previousAssignments,
    });
  } catch (error) {
    return {
      filePath,
      services: [],
      warnings: [error instanceof Error ? error.message : String(error)],
      newMatches: [],
    };
  }
}

export function parseManualServices(
  contents: string,
  nodes: readonly InfraNode[],
  options: {
    readonly filePath?: string;
    readonly previousAssignments?: readonly Service[];
  } = {},
): LoadedManualServices {
  const filePath = path.resolve(options.filePath ?? DEFAULT_SERVICES_FILE_PATH);

  let definitions: readonly ManualServiceDefinition[];
  try {
    const document = parseDocument(contents);
    if (document.errors.length > 0) {
      return {
        filePath,
        services: [],
        warnings: document.errors.map((error) => error.message),
        newMatches: [],
      };
    }

    const value = document.toJSON() as unknown;
    definitions = validateServicesConfig(value, filePath);
  } catch (error) {
    return {
      filePath,
      services: [],
      warnings: [error instanceof Error ? error.message : String(error)],
      newMatches: [],
    };
  }

  return resolveManualServices(definitions, nodes, filePath, options.previousAssignments);
}

function validateServicesConfig(
  value: unknown,
  filePath: string,
): readonly ManualServiceDefinition[] {
  if (!isRecord(value)) {
    throw new Error(`Invalid services file at ${filePath}: top-level YAML must be an object.`);
  }

  if (readInteger(value.version) !== SERVICES_FILE_VERSION) {
    throw new Error(
      `Invalid services file at ${filePath}: version must be ${SERVICES_FILE_VERSION}.`,
    );
  }

  if (!isRecord(value.services)) {
    throw new Error(`Invalid services file at ${filePath}: services must be an object.`);
  }

  const definitions: ManualServiceDefinition[] = [];
  for (const [serviceId, serviceValue] of Object.entries(value.services)) {
    if (!isRecord(serviceValue)) {
      throw new Error(`Invalid service "${serviceId}" in ${filePath}: service must be an object.`);
    }

    const name = readString(serviceValue.name);
    if (!name) {
      throw new Error(`Invalid service "${serviceId}" in ${filePath}: name is required.`);
    }

    const criticality = readString(serviceValue.criticality);
    if (
      criticality !== 'critical' &&
      criticality !== 'high' &&
      criticality !== 'medium' &&
      criticality !== 'low'
    ) {
      throw new Error(
        `Invalid service "${serviceId}" in ${filePath}: criticality must be critical, high, medium, or low.`,
      );
    }

    const resourcePatterns = readStringArray(serviceValue.resources);
    if (resourcePatterns.length === 0) {
      throw new Error(
        `Invalid service "${serviceId}" in ${filePath}: at least one resource pattern is required.`,
      );
    }

    definitions.push({
      id: slugifyServiceId(serviceId) || serviceId,
      name,
      criticality,
      ...(readString(serviceValue.owner) ? { owner: readString(serviceValue.owner) } : {}),
      resourcePatterns,
    });
  }

  return definitions;
}

function resolveManualServices(
  definitions: readonly ManualServiceDefinition[],
  nodes: readonly InfraNode[],
  filePath: string,
  previousAssignments: readonly Service[] | undefined,
): LoadedManualServices {
  const previousAssignmentsByService = new Map(
    (previousAssignments ?? []).map((service) => [service.id, new Set(service.resources.map((resource) => resource.nodeId))] as const),
  );
  const claimedResources = new Map<string, string>();
  const services: Service[] = [];
  const warnings: string[] = [];
  const newMatches: Array<{
    readonly serviceId: string;
    readonly serviceName: string;
    readonly resourceIds: readonly string[];
  }> = [];

  for (const definition of definitions) {
    const matchedResources = new Map<string, InfraNode>();
    const globMatchedNodeIds = new Set<string>();

    for (const pattern of definition.resourcePatterns) {
      const matches = resolvePatternMatches(pattern, nodes);
      if (matches.length === 0) {
        warnings.push(
          `Pattern "${pattern}" in service "${definition.id}" matched no resources.`,
        );
        continue;
      }

      if (pattern.includes('*')) {
        matches.forEach((node) => globMatchedNodeIds.add(node.id));
      }

      for (const match of matches) {
        const existingOwner = claimedResources.get(match.id);
        if (existingOwner && existingOwner !== definition.id) {
          throw new Error(
            `Resource "${match.id}" matches multiple services: "${existingOwner}" and "${definition.id}".`,
          );
        }
        claimedResources.set(match.id, definition.id);
        matchedResources.set(match.id, match);
      }
    }

    const previousResources = previousAssignmentsByService.get(definition.id) ?? new Set<string>();
    const flaggedNewMatches = Array.from(globMatchedNodeIds).filter(
      (nodeId) => !previousResources.has(nodeId),
    );
    if (flaggedNewMatches.length > 0) {
      newMatches.push({
        serviceId: definition.id,
        serviceName: definition.name,
        resourceIds: flaggedNewMatches.sort((left, right) => left.localeCompare(right)),
      });
    }

    services.push({
      id: definition.id,
      name: definition.name,
      criticality: definition.criticality,
      detectionSource: {
        type: 'manual',
        file: filePath,
        confidence: 1.0,
      },
      resources: Array.from(matchedResources.values())
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((node) => ({
          nodeId: node.id,
          role: classifyResourceRole(node),
          detectionSource: {
            type: 'manual',
            file: filePath,
            confidence: 1.0,
          },
        })),
      ...(definition.owner ? { owner: definition.owner } : {}),
      metadata: {},
    });
  }

  return {
    filePath,
    services,
    warnings,
    newMatches,
  };
}

function resolvePatternMatches(
  pattern: string,
  nodes: readonly InfraNode[],
): readonly InfraNode[] {
  const normalizedPattern = normalizeReference(pattern);
  const matcher = pattern.includes('*')
    ? new RegExp(`^${escapeRegex(normalizedPattern).replace(/\\\*/g, '[^:]*')}$`, 'i')
    : null;

  return nodes.filter((node) => {
    const references = collectNodeReferences(node);
    return Array.from(references).some((reference) =>
      matcher ? matcher.test(reference) : reference === normalizedPattern,
    );
  });
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is ServicesConfigRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== undefined);
}
