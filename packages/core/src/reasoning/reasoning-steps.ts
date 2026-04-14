import { generateRunbook } from '../drp/runbook/runbook-generator.js';
import { validateRunbookLiveness } from '../scenarios/runbook-validator.js';
import type { RealityGapServiceDetail } from '../scoring/reality-gap-types.js';
import type { ServicePostureService } from '../services/index.js';
import type { ReasoningChain, ReasoningScanResult, ReasoningStep } from './reasoning-types.js';

const SEVERITY_RANK: Readonly<Record<NonNullable<ReasoningStep['severity']>, number>> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function buildReasoningSteps(
  service: ServicePostureService,
  scanResult: ReasoningScanResult,
  realityGapService: RealityGapServiceDetail,
): readonly ReasoningStep[] {
  const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const serviceNodes = scanResult.nodes
    .filter((node) => nodeIds.has(node.id))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const serviceResults = scanResult.validationReport.results
    .filter((result) => nodeIds.has(result.nodeId))
    .slice()
    .sort(compareFindings);
  const impactedScenarios = (scanResult.scenarioAnalysis?.scenarios ?? [])
    .flatMap((scenario) => {
      const detail = scenario.coverage?.details.find((entry) => entry.serviceId === service.service.id);
      const impact = scenario.impact?.serviceImpact.find((entry) => entry.serviceId === service.service.id);
      if (!detail && (!impact || impact.status === 'unaffected')) {
        return [];
      }

      return [
        {
          scenario,
          verdict: detail?.verdict ?? scenario.coverage?.verdict ?? 'uncovered',
          affectedServices: scenario.impact?.serviceImpact.filter((entry) => entry.status !== 'unaffected').length ?? 0,
          status: impact?.status ?? 'degraded',
        },
      ];
    })
    .sort(
      (left, right) =>
        right.affectedServices - left.affectedServices ||
        left.scenario.name.localeCompare(right.scenario.name),
    )
    .slice(0, 3);
  const staleReferences = resolveServiceStaleReferences(service, scanResult);
  const steps: ReasoningStep[] = [];

  steps.push({
    type: 'service_composition',
    summary: `${service.service.name} consists of ${service.service.resources.length} resource${service.service.resources.length === 1 ? '' : 's'}.`,
    detail: serviceNodes
      .map((node) => {
        const role = service.service.resources.find((resource) => resource.nodeId === node.id)?.role ?? 'other';
        return `${node.name} (${node.type}, ${role})`;
      })
      .join('\n'),
    severity: null,
    confidence: null,
    source: null,
  });

  const criticalDependency = serviceNodes
    .slice()
    .sort(
      (left, right) =>
        (right.dependentsCount ?? 0) - (left.dependentsCount ?? 0) ||
        (right.blastRadius ?? 0) - (left.blastRadius ?? 0) ||
        left.id.localeCompare(right.id),
    )[0];
  if (criticalDependency) {
    steps.push({
      type: 'critical_dependency',
      summary: `${criticalDependency.name} is the most connected dependency in ${service.service.name}.`,
      detail: `${criticalDependency.dependentsCount ?? 0} direct dependent${criticalDependency.dependentsCount === 1 ? '' : 's'} and blast radius ${criticalDependency.blastRadius ?? 0}.`,
      severity: (criticalDependency.blastRadius ?? 0) > 2 ? 'high' : 'medium',
      confidence: null,
      source: 'graph-analysis',
    });
  }

  serviceResults
    .filter((result) => result.status === 'fail' || result.status === 'error' || result.status === 'warn')
    .slice(0, 5)
    .forEach((result) => {
      steps.push({
        type: 'finding',
        summary: `${result.nodeName} ${result.message}`,
        detail: result.remediation ?? null,
        severity: result.severity,
        confidence: resolveEvidenceConfidence(result),
        source: resolveEvidenceSource(result),
      });
    });

  const primaryEvidenceGap = realityGapService.gaps.find(
    (gap) => gap.type === 'no_tested_evidence' || gap.type === 'expired_evidence',
  );
  if (primaryEvidenceGap) {
    steps.push({
      type: 'evidence_gap',
      summary:
        primaryEvidenceGap.type === 'expired_evidence'
          ? `Test evidence expired ${primaryEvidenceGap.daysExpired} day${primaryEvidenceGap.daysExpired === 1 ? '' : 's'} ago.`
          : 'No tested recovery evidence is recorded for this service.',
      detail: primaryEvidenceGap.detail,
      severity: primaryEvidenceGap.type === 'expired_evidence' ? 'high' : 'critical',
      confidence: primaryEvidenceGap.type === 'expired_evidence' ? 0.2 : null,
      source: primaryEvidenceGap.type === 'expired_evidence' ? 'evidence-store' : null,
    });
  }

  impactedScenarios.forEach(({ scenario, verdict, affectedServices, status }) => {
    steps.push({
      type: 'scenario_impact',
      summary: `${scenario.name} leaves ${service.service.name} ${status.toUpperCase()} (${String(verdict).replace(/_/g, ' ')}).`,
      detail: `${affectedServices} service${affectedServices === 1 ? '' : 's'} are affected in this scenario.`,
      severity:
        verdict === 'uncovered' || verdict === 'degraded'
          ? 'high'
          : verdict === 'partially_covered'
            ? 'medium'
            : 'low',
      confidence: null,
      source: scenario.id,
    });
  });

  steps.push({
    type: 'runbook_status',
    summary:
      staleReferences.length === 0
        ? 'Runbook is aligned with the current scan.'
        : `Runbook references stale resources: ${staleReferences.slice(0, 3).join(', ')}.`,
    detail:
      staleReferences.length === 0
        ? null
        : `${staleReferences.length} stale reference${staleReferences.length === 1 ? '' : 's'} detected.`,
    severity: staleReferences.length === 0 ? 'low' : 'high',
    confidence: null,
    source: 'runbook-validator',
  });

  const worstFinding = service.score.findings.slice().sort(compareFindings)[0];
  const passingRules = serviceResults.filter((result) => result.status === 'pass');
  const testedRules = passingRules.filter((result) => resolveEvidenceType(result) === 'tested').length;
  steps.push({
    type: 'scoring_impact',
    summary:
      worstFinding?.severity === 'critical'
        ? 'Score ceiling applies at D (<=40) until the critical finding is resolved.'
        : worstFinding?.severity === 'high'
          ? 'Score ceiling applies at C (<=60) until the high finding is resolved.'
          : 'No severity ceiling currently applies to this service.',
    detail: `${testedRules}/${passingRules.length} passing rule${passingRules.length === 1 ? '' : 's'} are backed by tested evidence.`,
    severity:
      worstFinding?.severity === 'critical'
        ? 'critical'
        : worstFinding?.severity === 'high'
          ? 'high'
          : 'medium',
    confidence: null,
    source: 'service-scoring',
  });

  const positive = resolvePositiveStep(service, scanResult, realityGapService);
  if (positive) {
    steps.push(positive);
  }

  return steps;
}

export function condenseReasoningChain(
  chain: ReasoningChain,
  maxItems = 4,
): readonly string[] {
  const items = [
    ...chain.steps
      .filter((step) => step.type !== 'service_composition' && step.type !== 'critical_dependency')
      .map((step) => ({
        severity: step.severity,
        label: step.summary,
      })),
    ...chain.insights.map((insight) => ({
      severity: insight.severity,
      label: `${insight.type.replace(/_/g, ' ').toUpperCase()}: ${insight.summary}`,
    })),
  ];

  return items
    .slice()
    .sort(
      (left, right) =>
        (SEVERITY_RANK[right.severity ?? 'low'] ?? 0) - (SEVERITY_RANK[left.severity ?? 'low'] ?? 0) ||
        left.label.localeCompare(right.label),
    )
    .slice(0, maxItems)
    .map((item) => item.label);
}

function resolvePositiveStep(
  service: ServicePostureService,
  scanResult: ReasoningScanResult,
  realityGapService: RealityGapServiceDetail,
): ReasoningStep | null {
  if (realityGapService.provenRecoverability === 100) {
    return {
      type: 'positive',
      summary: `${service.service.name} has current tested evidence and no active recovery blockers.`,
      detail: 'Tested recovery evidence, scenario coverage, and runbook validation all passed.',
      severity: 'low',
      confidence: 1,
      source: 'reality-gap',
    };
  }

  const coveredScenario = scanResult.scenarioAnalysis?.scenarios
    .flatMap((scenario) =>
      scenario.coverage?.details.filter(
        (detail) => detail.serviceId === service.service.id && detail.verdict === 'covered',
      ) ?? [],
    )
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName))[0];
  if (!coveredScenario) {
    return null;
  }

  return {
    type: 'positive',
    summary: `${service.service.name} has at least one scenario with full coverage.`,
    detail: coveredScenario.reason,
    severity: 'low',
    confidence: coveredScenario.evidenceLevel === 'tested' ? 1 : null,
    source: 'scenario-analysis',
  };
}

function resolveServiceStaleReferences(
  service: ServicePostureService,
  scanResult: ReasoningScanResult,
): readonly string[] {
  if (!scanResult.drpPlan) {
    return [];
  }

  const nodeIds = new Set(service.service.resources.map((resource) => resource.nodeId));
  const runbook = generateRunbook(scanResult.drpPlan, scanResult.nodes);
  const componentRunbooks = runbook.componentRunbooks.filter((component) => nodeIds.has(component.componentId));
  if (componentRunbooks.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      validateRunbookLiveness(
        {
          ...runbook,
          componentRunbooks,
        },
        scanResult.nodes,
      ).staleReferences.map((reference) => reference.referencedResourceId),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function compareFindings(
  left: { readonly severity: string; readonly ruleId: string },
  right: { readonly severity: string; readonly ruleId: string },
): number {
  return (
    (SEVERITY_RANK[right.severity as keyof typeof SEVERITY_RANK] ?? 0) -
      (SEVERITY_RANK[left.severity as keyof typeof SEVERITY_RANK] ?? 0) ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

function resolveEvidenceType(result: ReasoningScanResult['validationReport']['results'][number]): string | null {
  if ('weightBreakdown' in result && 'evidenceType' in result.weightBreakdown) {
    const evidenceType = (result.weightBreakdown as { readonly evidenceType?: unknown }).evidenceType;
    return typeof evidenceType === 'string' ? evidenceType : null;
  }
  return null;
}

function resolveEvidenceConfidence(
  result: ReasoningScanResult['validationReport']['results'][number],
): number | null {
  if ('weightBreakdown' in result && 'evidenceConfidence' in result.weightBreakdown) {
    const confidence = (result.weightBreakdown as { readonly evidenceConfidence?: unknown })
      .evidenceConfidence;
    return typeof confidence === 'number' ? confidence : null;
  }
  return null;
}

function resolveEvidenceSource(
  result: ReasoningScanResult['validationReport']['results'][number],
): string | null {
  if ('evidence' in result && Array.isArray(result.evidence) && result.evidence.length > 0) {
    const source = result.evidence[0]?.source;
    if (!source) {
      return result.ruleId;
    }
    if (source.origin === 'test') {
      return source.testType;
    }
    return source.origin;
  }
  return result.ruleId;
}
