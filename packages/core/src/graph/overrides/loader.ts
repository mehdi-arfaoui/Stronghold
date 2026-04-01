import fs from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import {
  DEFAULT_GRAPH_OVERRIDES_PATH,
  GRAPH_OVERRIDES_VERSION,
  type GraphCriticalityOverride,
  type GraphEdgeOverride,
  type GraphOverrides,
} from './types.js';

type OverrideRecord = Record<string, unknown>;

export class GraphOverrideValidationError extends Error {
  public readonly filePath: string;
  public readonly issues: readonly string[];

  public constructor(filePath: string, issues: readonly string[]) {
    super(buildValidationMessage(filePath, issues));
    this.name = 'GraphOverrideValidationError';
    this.filePath = filePath;
    this.issues = issues;
  }
}

export function loadGraphOverrides(filePath = DEFAULT_GRAPH_OVERRIDES_PATH): GraphOverrides | null {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8');
  return parseGraphOverrides(contents, resolvedPath);
}

export function parseGraphOverrides(contents: string, filePath = DEFAULT_GRAPH_OVERRIDES_PATH): GraphOverrides {
  const document = parseDocument(contents);
  if (document.errors.length > 0) {
    throw new GraphOverrideValidationError(
      filePath,
      document.errors.map((error) => error.message),
    );
  }

  const parsed = document.toJSON() as unknown;
  return validateGraphOverrides(parsed, filePath);
}

export function validateGraphOverrides(
  value: unknown,
  filePath = DEFAULT_GRAPH_OVERRIDES_PATH,
): GraphOverrides {
  const issues: string[] = [];
  if (!isRecord(value)) {
    throw new GraphOverrideValidationError(filePath, ['Overrides file must contain a YAML object.']);
  }

  const version = readInteger(value.version);
  if (version !== GRAPH_OVERRIDES_VERSION) {
    issues.push(
      `version must be ${GRAPH_OVERRIDES_VERSION}. Received ${String(value.version ?? 'undefined')}.`,
    );
  }

  const addEdges = readEdgeOverrides(value.add_edges, 'add_edges', issues);
  const removeEdges = readEdgeOverrides(value.remove_edges, 'remove_edges', issues);
  const criticalityOverrides = readCriticalityOverrides(
    value.criticality_overrides,
    'criticality_overrides',
    issues,
  );

  if (issues.length > 0) {
    throw new GraphOverrideValidationError(filePath, issues);
  }

  return {
    version: GRAPH_OVERRIDES_VERSION,
    add_edges: addEdges,
    remove_edges: removeEdges,
    criticality_overrides: criticalityOverrides,
  };
}

export function renderGraphOverridesTemplate(): string {
  return [
    `version: ${GRAPH_OVERRIDES_VERSION}`,
    'add_edges:',
    '  # - source: arn:aws:lambda:eu-west-1:111111111111:function:api',
    '  #   target: arn:aws:rds:eu-west-1:111111111111:db:orders',
    '  #   type: DEPENDS_ON',
    '  #   reason: API depends on the orders database for writes.',
    'remove_edges:',
    '  # - source: arn:aws:elasticloadbalancing:eu-west-1:111111111111:loadbalancer/app/web',
    '  #   target: arn:aws:sqs:eu-west-1:111111111111:jobs',
    '  #   type: ROUTES_TO',
    '  #   reason: Load balancer does not directly route to the queue.',
    'criticality_overrides:',
    '  # - node: arn:aws:rds:eu-west-1:111111111111:db:orders',
    '  #   score: 95',
    '  #   reason: Orders database is business-critical for checkout recovery.',
  ].join('\n');
}

function readEdgeOverrides(
  value: unknown,
  section: string,
  issues: string[],
): readonly GraphEdgeOverride[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(`${section} must be an array.`);
    return [];
  }

  return value
    .map((entry, index) => readEdgeOverride(entry, `${section}[${index}]`, issues))
    .filter((entry): entry is GraphEdgeOverride => Boolean(entry));
}

function readEdgeOverride(
  value: unknown,
  pathLabel: string,
  issues: string[],
): GraphEdgeOverride | null {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object.`);
    return null;
  }

  const source = readNonEmptyString(value.source);
  const target = readNonEmptyString(value.target);
  const type = readNonEmptyString(value.type);
  const reason = readNonEmptyString(value.reason);

  if (!source) issues.push(`${pathLabel}.source is required.`);
  if (!target) issues.push(`${pathLabel}.target is required.`);
  if (!type) issues.push(`${pathLabel}.type is required.`);
  if (!reason) issues.push(`${pathLabel}.reason is required.`);

  if (!source || !target || !type || !reason) {
    return null;
  }

  return { source, target, type, reason };
}

function readCriticalityOverrides(
  value: unknown,
  section: string,
  issues: string[],
): readonly GraphCriticalityOverride[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push(`${section} must be an array.`);
    return [];
  }

  return value
    .map((entry, index) => readCriticalityOverride(entry, `${section}[${index}]`, issues))
    .filter((entry): entry is GraphCriticalityOverride => Boolean(entry));
}

function readCriticalityOverride(
  value: unknown,
  pathLabel: string,
  issues: string[],
): GraphCriticalityOverride | null {
  if (!isRecord(value)) {
    issues.push(`${pathLabel} must be an object.`);
    return null;
  }

  const node = readNonEmptyString(value.node) ?? readNonEmptyString(value.node_id);
  const reason = readNonEmptyString(value.reason);
  const score = readNumber(value.score);

  if (!node) issues.push(`${pathLabel}.node is required.`);
  if (score == null) issues.push(`${pathLabel}.score must be a number between 0 and 100.`);
  if (!reason) issues.push(`${pathLabel}.reason is required.`);

  if (score != null && (score < 0 || score > 100)) {
    issues.push(`${pathLabel}.score must be between 0 and 100.`);
  }

  if (!node || score == null || score < 0 || score > 100 || !reason) {
    return null;
  }

  return { node, score, reason };
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is OverrideRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildValidationMessage(filePath: string, issues: readonly string[]): string {
  return `Invalid graph overrides file at ${filePath}:\n- ${issues.join('\n- ')}`;
}
