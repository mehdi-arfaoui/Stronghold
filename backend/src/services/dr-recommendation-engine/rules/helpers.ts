import {
  readBoolean,
  readNumber,
  readPositiveNumberFromKeys,
  readString,
  readStringFromKeys,
} from '../metadataUtils.js';
import type { RecommendationRuleNode } from './types.js';

const UNKNOWN_SERVICE = 'service inconnu';
const UNKNOWN_INSTANCE = 'type inconnu';
const UNKNOWN_LOCATION = 'localisation inconnue';

function normalizeMachineType(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const segments = trimmed.split('/');
  return segments[segments.length - 1] || trimmed;
}

export function getDisplayName(node: RecommendationRuleNode): string {
  const nodeName = String(node.name || '').trim();
  if (nodeName.length > 0) return nodeName;

  const metadataName =
    readStringFromKeys(node.metadata, ['displayName', 'businessName', 'name', 'serviceName']) || null;
  return metadataName || UNKNOWN_SERVICE;
}

export function getInstanceTypeDisplay(node: RecommendationRuleNode): string {
  const value =
    readStringFromKeys(node.metadata, [
      'instanceType',
      'instance_type',
      'dbInstanceClass',
      'instanceClass',
      'cacheNodeType',
      'nodeType',
      'vmSize',
      'machineType',
      'skuName',
      'sku',
      'tier',
    ]) || null;
  if (!value) return UNKNOWN_INSTANCE;
  return normalizeMachineType(value);
}

export function getEngineDisplay(node: RecommendationRuleNode): string {
  return readStringFromKeys(node.metadata, ['engine', 'databaseEngine', 'engineVersion']) || 'engine inconnu';
}

export function getLocationDisplay(node: RecommendationRuleNode): string {
  const directRegion = readString(node.region);
  if (directRegion) return directRegion;

  const directAz = readString(node.availabilityZone);
  if (directAz) return directAz;

  const metadataLocation =
    readStringFromKeys(node.metadata, [
      'region',
      'location',
      'geoReplicaLocation',
      'availabilityZone',
      'availability_zone',
      'zone',
      'primaryRegion',
    ]) || null;
  if (!metadataLocation) return UNKNOWN_LOCATION;

  return normalizeMachineType(metadataLocation);
}

export function getServiceSubtitle(node: RecommendationRuleNode): string {
  return `${getInstanceTypeDisplay(node)} - ${getLocationDisplay(node)}`;
}

export function readMetadataBoolean(metadata: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const parsed = readBoolean(metadata[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

export function readMetadataNumber(metadata: Record<string, unknown>, keys: string[]): number | null {
  const positive = readPositiveNumberFromKeys(metadata, keys);
  if (positive != null) return positive;
  for (const key of keys) {
    const parsed = readNumber(metadata[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

export function hasMetadataValue(metadata: Record<string, unknown>, key: string): boolean {
  if (!(key in metadata)) return false;
  const value = metadata[key];
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function splitCriticalMetadataExpression(expression: string): string[] {
  return expression
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function resolveMissingCriticalMetadata(
  metadata: Record<string, unknown>,
  criticalMetadata: string[],
): string[] {
  const missing: string[] = [];
  for (const expression of criticalMetadata) {
    const alternatives = splitCriticalMetadataExpression(expression);
    const hasKnownValue = alternatives.some((key) => hasMetadataValue(metadata, key));
    if (!hasKnownValue) {
      missing.push(expression);
    }
  }
  return missing;
}
