import { randomUUID } from 'crypto';
import type { InfraNodeAttrs, GraphAnalysisReport, AutoDetectedRisk } from '../types/index.js';
import { NodeType } from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';

export function detectRisks(
  graph: GraphInstance,
  analysis: GraphAnalysisReport,
): AutoDetectedRisk[] {
  const risks: AutoDetectedRisk[] = [];

  for (const spof of analysis.spofs) {
    risks.push({
      id: randomUUID(),
      category: 'infrastructure',
      title: `Single Point of Failure: ${spof.nodeName}`,
      description: `${spof.nodeName} (${spof.nodeType}) is a SPOF whose failure would impact ${spof.blastRadius} services.`,
      probability: estimateProbability(spof.severity),
      impact: mapSeverityToImpact(spof.severity),
      linkedNodeIds: [spof.nodeId],
      mitigations: [
        {
          title: spof.recommendation,
          effort: estimateEffort(spof.severity),
          priority: spof.severity === 'critical' ? 'immediate' : 'planned',
        },
      ],
      autoDetected: true,
      detectionMethod: 'graph_analysis_spof',
    });
  }

  for (const issue of analysis.redundancyIssues) {
    for (const check of issue.failedChecks) {
      risks.push({
        id: randomUUID(),
        category: 'infrastructure',
        title: `Missing redundancy: ${issue.nodeName} (${check.check})`,
        description: check.recommendation,
        probability: 3,
        impact: check.impact === 'critical' ? 5 : check.impact === 'high' ? 4 : 3,
        linkedNodeIds: [issue.nodeId],
        mitigations: [
          {
            title: check.recommendation,
            effort: 'medium',
            priority: 'planned',
          },
        ],
        autoDetected: true,
        detectionMethod: `redundancy_${check.check}`,
      });
    }
  }

  for (const regional of analysis.regionalRisks) {
    risks.push({
      id: randomUUID(),
      category: 'infrastructure',
      title: `Regional concentration: ${regional.concentration}% in ${regional.region}`,
      description: regional.recommendation,
      probability: 2,
      impact: 5,
      linkedNodeIds: [],
      mitigations: [
        {
          title: 'Distribute critical services across at least 2 regions',
          effort: 'high',
          priority: 'strategic',
        },
      ],
      autoDetected: true,
      detectionMethod: 'regional_concentration',
    });
  }

  for (const cycle of analysis.circularDeps) {
    risks.push({
      id: randomUUID(),
      category: 'application',
      title: 'Circular dependency detected',
      description: `Cycle: ${cycle.nodes.map((n) => n.name).join(' → ')}. Risk of cascade failures.`,
      probability: 3,
      impact: 4,
      linkedNodeIds: cycle.nodes.map((n) => n.id),
      mitigations: [
        {
          title: 'Decouple via message queue or circuit breaker',
          effort: 'medium',
          priority: 'planned',
        },
      ],
      autoDetected: true,
      detectionMethod: 'circular_dependency',
    });
  }

  graph.forEachNode((nodeId, attrs) => {
    const a = attrs as unknown as InfraNodeAttrs;
    if (a.type === NodeType.THIRD_PARTY_API || a.type === NodeType.SAAS_SERVICE) {
      const dependents = graph.inNeighbors(nodeId);
      if (dependents.length > 0) {
        risks.push({
          id: randomUUID(),
          category: 'external',
          title: `External dependency without fallback: ${a.name}`,
          description: `${dependents.length} services depend on ${a.name} without detected fallback mechanism.`,
          probability: 3,
          impact: Math.min(5, dependents.length),
          linkedNodeIds: [nodeId, ...dependents],
          mitigations: [
            {
              title: 'Implement circuit breaker and degraded mode',
              effort: 'medium',
              priority: 'planned',
            },
          ],
          autoDetected: true,
          detectionMethod: 'third_party_no_fallback',
        });
      }
    }
  });

  graph.forEachNode((nodeId, attrs) => {
    const a = attrs as unknown as InfraNodeAttrs;
    if (a.type === NodeType.DATABASE && a.metadata?.isPubliclyAccessible) {
      risks.push({
        id: randomUUID(),
        category: 'network',
        title: `Publicly accessible database: ${a.name}`,
        description: `${a.name} is publicly accessible. This represents a significant security risk.`,
        probability: 4,
        impact: 5,
        linkedNodeIds: [nodeId],
        mitigations: [
          {
            title: 'Restrict database access to private subnets only',
            effort: 'low',
            priority: 'immediate',
          },
        ],
        autoDetected: true,
        detectionMethod: 'public_database',
      });
    }
  });

  return risks;
}

function estimateProbability(severity: string): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

function mapSeverityToImpact(severity: string): number {
  switch (severity) {
    case 'critical':
      return 5;
    case 'high':
      return 4;
    case 'medium':
      return 3;
    default:
      return 2;
  }
}

function estimateEffort(severity: string): 'low' | 'medium' | 'high' {
  switch (severity) {
    case 'critical':
      return 'high';
    case 'high':
      return 'medium';
    default:
      return 'low';
  }
}
