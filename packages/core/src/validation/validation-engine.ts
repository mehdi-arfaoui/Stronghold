import { getMetadata, readString } from '../graph/analysis-helpers.js';
import type { DRPlan } from '../drp/drp-types.js';
import type {
  DRCategory,
  InfraNode,
  ScoreBreakdown,
  ValidationContext,
  ValidationEdge,
  ValidationReport,
  ValidationResult,
  ValidationRule,
  WeightedValidationResult,
} from './validation-types.js';
import {
  collectNodeKinds,
  collectNodeReferences,
  normalizeType,
} from './validation-node-utils.js';

const SCORING_METHOD =
  'Weighted by rule severity \u00d7 node criticality \u00d7 blast radius (log2, direct dependents only)';
const SCORE_DISCLAIMER =
  'This score measures the percentage of recommended DR mechanisms in place, weighted by severity and impact. It does not guarantee recovery capability \u2014 only a tested DR plan can provide that assurance.';
const DR_CATEGORIES: readonly DRCategory[] = [
  'backup',
  'redundancy',
  'failover',
  'detection',
  'recovery',
  'replication',
];
const NON_DEPENDENCY_EDGE_TYPES = new Set([
  'BACKS_UP_TO',
  'CONTAINS',
  'MONITORS',
  'REPLICATES_TO',
  'PLACED_IN',
  'SECURED_BY',
  'IAM_ACCESS',
  'DEAD_LETTER',
]);

/** Direct blast radius weighting based on observed dependents only. */
export function blastRadiusWeight(directDependentCount: number): number {
  if (directDependentCount === 0) return 1;
  return Math.log2(directDependentCount + 1);
}

/** Executes every applicable validation rule against the provided infrastructure graph. */
export function runValidation(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ValidationEdge>,
  rules: readonly ValidationRule[],
  drpPlan?: DRPlan,
): ValidationReport {
  const backupCoverage = buildBackupCoverage(nodes, edges);
  const context: ValidationContext = {
    allNodes: nodes,
    edges,
    ...(drpPlan ? { drpPlan } : {}),
    ...(backupCoverage.size > 0 ? { backupCoverage } : {}),
  };
  const results = nodes.flatMap((node) => runNodeRules(node, context, rules, edges));
  const passed = countResults(results, 'pass');
  const failed = countResults(results, 'fail');
  const warnings = countResults(results, 'warn');
  const skipped = countResults(results, 'skip');
  const errors = countResults(results, 'error');
  const scoreBreakdown = calculateScoreBreakdown(results);

  return {
    timestamp: new Date().toISOString(),
    totalChecks: results.length,
    passed,
    failed,
    warnings,
    skipped,
    errors,
    results,
    score: scoreBreakdown.overall,
    scoreBreakdown,
    criticalFailures: collectCriticalFailures(results),
    scannedResources: nodes.length,
  };
}

function buildBackupCoverage(
  nodes: readonly InfraNode[],
  edges: ReadonlyArray<ValidationEdge>,
): ReadonlyMap<string, string> {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const coverage = new Map<string, string>();

  for (const edge of edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    if (!collectNodeKinds(sourceNode).has('backup-plan')) continue;

    for (const reference of collectNodeReferences(targetNode)) {
      coverage.set(reference, sourceNode.id);
    }
  }

  return coverage;
}

function runNodeRules(
  node: InfraNode,
  context: ValidationContext,
  rules: readonly ValidationRule[],
  edges: ReadonlyArray<ValidationEdge>,
): readonly WeightedValidationResult[] {
  return rules
    .filter((rule) => isRuleApplicable(rule, node))
    .map((rule) => {
      try {
        return toWeightedResult(rule.validate(node, context), node, rule, edges);
      } catch (error) {
        return toWeightedResult(
          {
            ruleId: rule.id,
            nodeId: node.id,
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
          node,
          rule,
          edges,
        );
      }
    });
}

function isRuleApplicable(rule: ValidationRule, node: InfraNode): boolean {
  const kinds = collectNodeKinds(node);
  return rule.appliesToTypes.some((type) => kinds.has(normalizeType(type)));
}

function toWeightedResult(
  result: ValidationResult,
  node: InfraNode,
  rule: ValidationRule,
  edges: ReadonlyArray<ValidationEdge>,
): WeightedValidationResult {
  const directDependentCount = countDirectDependents(node.id, edges);
  const severityWeight = severityWeightFor(rule.severity);
  const criticalityWeight = criticalityWeightFor(node);
  const blastWeight = blastRadiusWeight(directDependentCount);

  return {
    ...result,
    severity: rule.severity,
    category: rule.category,
    nodeName: node.name,
    nodeType: node.type,
    weight: severityWeight * criticalityWeight * blastWeight,
    weightBreakdown: {
      severityWeight,
      criticalityWeight,
      blastRadiusWeight: blastWeight,
      directDependentCount,
    },
  };
}

function countDirectDependents(
  nodeId: string,
  edges: ReadonlyArray<ValidationEdge>,
): number {
  const dependents = new Set(
    edges
      .filter((edge) => edge.target === nodeId && !NON_DEPENDENCY_EDGE_TYPES.has(edge.type.toUpperCase()))
      .map((edge) => edge.source),
  );
  return dependents.size;
}

function severityWeightFor(severity: ValidationRule['severity']): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}

function criticalityWeightFor(node: InfraNode): number {
  const metadataValue = readString(getMetadata(node).criticality)?.toLowerCase();
  if (metadataValue === 'critical') return 4;
  if (metadataValue === 'high') return 3;
  if (metadataValue === 'medium') return 2;
  if (metadataValue === 'low') return 1;
  return 2;
}

function countResults(
  results: readonly WeightedValidationResult[],
  status: ValidationResult['status'],
): number {
  return results.filter((result) => result.status === status).length;
}

function calculateScoreBreakdown(
  results: readonly WeightedValidationResult[],
): ScoreBreakdown {
  const byCategory = createCategoryRecord(0);
  const categoryScores = new Map<DRCategory, number>();
  const populatedCategories = new Set<DRCategory>();

  for (const category of DR_CATEGORIES) {
    const categoryResults = results.filter((result) => result.category === category);
    if (categoryResults.length > 0) populatedCategories.add(category);
    categoryScores.set(category, scoreResults(categoryResults));
    byCategory[category] = categoryScores.get(category) ?? 0;
  }

  const overall = scoreResults(results);
  const weakestCandidates = DR_CATEGORIES.filter((category) => populatedCategories.has(category));
  const weakestCategory = (weakestCandidates.length > 0 ? weakestCandidates : DR_CATEGORIES).reduce(
    (current, category) =>
      (categoryScores.get(category) ?? 0) < (categoryScores.get(current) ?? 0) ? category : current,
  );

  return {
    overall,
    byCategory,
    grade: gradeForScore(overall),
    weakestCategory,
    scoringMethod: SCORING_METHOD,
    disclaimer: SCORE_DISCLAIMER,
  };
}

function scoreResults(results: readonly WeightedValidationResult[]): number {
  if (results.length > 0 && results.every((result) => result.status === 'skip')) {
    return 100;
  }

  const scored = results.filter((result) => scoreValueFor(result.status) !== null);
  const denominator = scored.reduce((sum, result) => sum + result.weight, 0);
  if (denominator === 0) return 0;

  const numerator = scored.reduce(
    (sum, result) => sum + result.weight * (scoreValueFor(result.status) ?? 0),
    0,
  );
  return Math.round((numerator / denominator) * 100);
}

function scoreValueFor(status: ValidationResult['status']): number | null {
  if (status === 'pass') return 1;
  if (status === 'warn') return 0.5;
  if (status === 'fail') return 0;
  return null;
}

function gradeForScore(score: number): ScoreBreakdown['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function collectCriticalFailures(
  results: readonly WeightedValidationResult[],
): readonly WeightedValidationResult[] {
  return results
    .filter(
      (result) =>
        result.severity === 'critical' &&
        (result.status === 'fail' || result.status === 'error'),
    )
    .sort(compareByImpact);
}

function compareByImpact(
  left: WeightedValidationResult,
  right: WeightedValidationResult,
): number {
  return (
    severityWeightFor(right.severity) - severityWeightFor(left.severity) ||
    right.weight - left.weight ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

function createCategoryRecord(value: number): Record<DRCategory, number> {
  return {
    backup: value,
    redundancy: value,
    failover: value,
    detection: value,
    recovery: value,
    replication: value,
  };
}
