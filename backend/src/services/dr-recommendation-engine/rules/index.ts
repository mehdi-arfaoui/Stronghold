import { resolveCloudServiceResolution } from '../cloudServiceMapping.js';
import { asRecord, readStringFromKeys } from '../metadataUtils.js';
import { appLogger } from '../../../utils/logger.js';
import { awsRules } from './aws.js';
import { azureRules } from './azure.js';
import { getDisplayName, resolveMissingCriticalMetadata } from './helpers.js';
import { gcpRules } from './gcp.js';
import type {
  EvaluatedRecommendation,
  RecommendationRuleNode,
  ResilienceRule,
} from './types.js';

type RuleNodeBuildInput = {
  id: string;
  name: string;
  nodeType: string;
  provider?: string | null;
  metadata?: unknown;
  region?: string | null;
  availabilityZone?: string | null;
};

const WILDCARD_PROVIDER = '*' as const;

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function isAzureStandardLoadBalancer(node: RecommendationRuleNode): boolean {
  if (node.resolution.provider !== 'azure') return false;
  if (node.resolution.category !== 'loadbalancer') return false;
  const sku = readStringFromKeys(node.metadata, ['sku', 'skuName']) || '';
  return sku.toLowerCase().includes('standard');
}

const RESILIENT_BY_DESIGN_MATCHERS: Array<{
  id: string;
  appliesTo: (node: RecommendationRuleNode) => boolean;
}> = [
  {
    id: 'aws-managed-resilient-services',
    appliesTo: (node) =>
      node.resolution.provider === 'aws' &&
      ['lambda', 'sqs', 'sns', 'alb', 'apiGateway'].includes(node.resolution.kind),
  },
  {
    id: 'azure-functions',
    appliesTo: (node) => node.resolution.provider === 'azure' && node.resolution.kind === 'functions',
  },
  {
    id: 'azure-standard-load-balancer',
    appliesTo: (node) => isAzureStandardLoadBalancer(node),
  },
  {
    id: 'gcp-cloud-functions',
    appliesTo: (node) => node.resolution.provider === 'gcp' && node.resolution.kind === 'cloudFunctions',
  },
];

const ALL_RULES_INTERNAL: ResilienceRule[] = [...awsRules, ...azureRules, ...gcpRules];

const RULES_BY_PROVIDER: Record<string, ResilienceRule[]> = {
  aws: ALL_RULES_INTERNAL.filter((rule) => rule.provider === 'aws' || rule.provider === WILDCARD_PROVIDER),
  azure: ALL_RULES_INTERNAL.filter(
    (rule) => rule.provider === 'azure' || rule.provider === WILDCARD_PROVIDER,
  ),
  gcp: ALL_RULES_INTERNAL.filter((rule) => rule.provider === 'gcp' || rule.provider === WILDCARD_PROVIDER),
  other: ALL_RULES_INTERNAL.filter((rule) => rule.provider === WILDCARD_PROVIDER),
};

function getCandidateRules(node: RecommendationRuleNode): ResilienceRule[] {
  const candidates = RULES_BY_PROVIDER[node.provider] ?? RULES_BY_PROVIDER.other ?? [];
  return candidates.filter((rule) => !rule.kinds || rule.kinds.includes(node.resolution.kind));
}

export const ALL_RULES: ResilienceRule[] = ALL_RULES_INTERNAL;

export function buildRecommendationRuleNode(input: RuleNodeBuildInput): RecommendationRuleNode {
  const metadata = asRecord(input.metadata);
  const nodeType = String(input.nodeType || '').toUpperCase();
  const providerHint = input.provider ?? readStringFromKeys(metadata, ['provider', 'cloudProvider']) ?? null;
  const resolution = resolveCloudServiceResolution({
    provider: providerHint,
    nodeType,
    metadata,
  });

  return {
    id: input.id,
    name: String(input.name || '').trim() || 'service inconnu',
    type: nodeType,
    provider: resolution.provider,
    metadata,
    resolution,
    region: input.region ?? null,
    availabilityZone: input.availabilityZone ?? null,
  };
}

export function isNodeResilientByDesign(node: RecommendationRuleNode): boolean {
  return RESILIENT_BY_DESIGN_MATCHERS.some((matcher) => matcher.appliesTo(node));
}

export function evaluateRulesForNode(
  node: RecommendationRuleNode,
  baseCostMonthly: number,
  pricingSource: string,
  pricingConfidence: number,
): EvaluatedRecommendation[] {
  if (isNodeResilientByDesign(node)) {
    return [];
  }

  const recos: EvaluatedRecommendation[] = [];
  const candidateRules = getCandidateRules(node);

  for (const rule of candidateRules) {
    if (!rule.appliesTo(node)) continue;
    if (rule.isSatisfied(node)) continue;

    const result = rule.generate(node, baseCostMonthly);
    const costDeltaRaw = baseCostMonthly * result.costDeltaMultiplier + (result.costDeltaFixed || 0);
    const costDelta = roundMoney(Math.max(0, costDeltaRaw));

    const missingMetadata = resolveMissingCriticalMetadata(node.metadata, rule.criticalMetadata || []);
    if (missingMetadata.length > 0 && !result.requiresVerification) {
      result.requiresVerification = true;
    }

    if (missingMetadata.length > 0) {
      appLogger.warn('dr_recommendation.rule_missing_metadata', {
        ruleId: rule.id,
        nodeId: node.id,
        nodeName: getDisplayName(node),
        provider: node.provider,
        nodeType: node.type,
        missingCriticalMetadata: missingMetadata,
      });
    }

    recos.push({
      ruleId: rule.id,
      nodeId: node.id,
      nodeName: getDisplayName(node),
      nodeType: node.type,
      provider: node.provider,
      result,
      baseCostMonthly: roundMoney(Math.max(0, baseCostMonthly)),
      costDeltaMonthly: costDelta,
      costDeltaAnnual: roundMoney(costDelta * 12),
      pricingSource,
      pricingConfidence,
      resilientByDesign: false,
      missingCriticalMetadata: missingMetadata,
    });
  }

  return recos;
}

export function evaluatePrimaryRuleForNode(
  node: RecommendationRuleNode,
  baseCostMonthly: number,
  pricingSource: string,
  pricingConfidence: number,
): EvaluatedRecommendation | null {
  const recos = evaluateRulesForNode(node, baseCostMonthly, pricingSource, pricingConfidence);
  return recos[0] || null;
}
