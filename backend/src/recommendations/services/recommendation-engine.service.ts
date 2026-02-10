import type { GraphInstance } from '../../graph/graphService.js';
import type { InfraNodeAttrs } from '../../graph/types.js';

export interface Recommendation {
  id: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  description: string;
  action: string;
  category: 'spof' | 'backup' | 'redundancy' | 'monitoring' | 'network' | 'process' | 'compliance';
  affectedNodeIds: string[];
  source: 'rule' | 'normative' | 'ai';
  confidence: 'high' | 'medium' | 'low';
  normativeReference?: string;
  effort: 'low' | 'medium' | 'high';
}

type RecommendationRule = {
  id: string;
  title: string;
  priority: Recommendation['priority'];
  category: Recommendation['category'];
  normativeReference: string;
  effort: Recommendation['effort'];
  evaluate: (graph: GraphInstance, nodeId: string, attrs: InfraNodeAttrs) => Recommendation | null;
};

const RULES: RecommendationRule[] = [
  {
    id: 'SPOF_NO_REDUNDANCY',
    title: 'SPOF sans redondance',
    priority: 'P0',
    category: 'spof',
    normativeReference: 'ISO 22301 §8.4.4',
    effort: 'high',
    evaluate: (_graph, nodeId, attrs) => {
      const redundancyScore = Number(attrs.redundancyScore ?? 0);
      if (!attrs.isSPOF || redundancyScore >= 20) return null;
      return {
        id: `${nodeId}-SPOF_NO_REDUNDANCY`,
        priority: 'P0',
        title: 'Ajouter de la redondance sur ce SPOF',
        description: `${attrs.name} est un point de defaillance unique avec une redondance faible (${redundancyScore}).`,
        action: 'Ajouter replica, multi-AZ et load balancer pour supprimer le SPOF.',
        category: 'spof',
        affectedNodeIds: [nodeId],
        source: 'rule',
        confidence: 'high',
        normativeReference: 'ISO 22301 §8.4.4',
        effort: 'high',
      };
    },
  },
  {
    id: 'NO_BACKUP_DATABASE',
    title: 'Base de donnees sans backup',
    priority: 'P0',
    category: 'backup',
    normativeReference: 'NIST SP 800-34 §3.4.2',
    effort: 'medium',
    evaluate: (graph, nodeId, attrs) => {
      if (attrs.type !== 'DATABASE') return null;
      const metadata = attrs.metadata ?? {};
      const hasBackup = Boolean((metadata as Record<string, unknown>).hasBackup);
      const hasBackupEdge = graph.outEdges(nodeId).some((edgeId) => {
        const edge = graph.getEdgeAttributes(edgeId) as { type?: string };
        return edge.type === 'BACKS_UP_TO';
      });
      if (hasBackup || hasBackupEdge) return null;
      return {
        id: `${nodeId}-NO_BACKUP_DATABASE`,
        priority: 'P0',
        title: 'Configurer des sauvegardes automatiques',
        description: `Aucune sauvegarde detectee pour ${attrs.name}.`,
        action: 'Configurer backup auto cross-region avec retention 30 jours minimum.',
        category: 'backup',
        affectedNodeIds: [nodeId],
        source: 'rule',
        confidence: 'high',
        normativeReference: 'NIST SP 800-34 §3.4.2',
        effort: 'medium',
      };
    },
  },
  {
    id: 'RTO_EXCEEDS_MTPD',
    title: 'RTO superieur au MTPD',
    priority: 'P0',
    category: 'process',
    normativeReference: 'ISO 22301 §8.4.1',
    effort: 'high',
    evaluate: (_graph, nodeId, attrs) => {
      const rto = Number(attrs.validatedRTO ?? attrs.suggestedRTO ?? 0);
      const mtpd = Number(attrs.validatedMTPD ?? attrs.suggestedMTPD ?? 0);
      if (rto <= 0 || mtpd <= 0 || rto <= mtpd) return null;
      return {
        id: `${nodeId}-RTO_EXCEEDS_MTPD`,
        priority: 'P0',
        title: 'RTO non compatible avec le MTPD',
        description: `${attrs.name}: RTO (${rto} min) superieur au MTPD (${mtpd} min).`,
        action: 'Le plan de reprise est insuffisant: automatiser le failover et reduire le RTO.',
        category: 'process',
        affectedNodeIds: [nodeId],
        source: 'rule',
        confidence: 'high',
        normativeReference: 'ISO 22301 §8.4.1',
        effort: 'high',
      };
    },
  },
  {
    id: 'DEEP_DEPENDENCY_CHAIN',
    title: 'Chaine de dependance profonde',
    priority: 'P2',
    category: 'redundancy',
    normativeReference: 'NIST SP 800-34 §3.4',
    effort: 'high',
    evaluate: (graph, nodeId, attrs) => {
      const depthChain = computeMaxDepth(graph, nodeId, new Set([nodeId]));
      const redundant = Number(attrs.redundancyScore ?? 0) >= 50;
      if (depthChain <= 5 || redundant) return null;
      return {
        id: `${nodeId}-DEEP_DEPENDENCY_CHAIN`,
        priority: 'P2',
        title: 'Simplifier la chaine de dependances',
        description: `${attrs.name} presente une profondeur de dependance de ${depthChain}.`,
        action: 'Simplifier l architecture ou ajouter de la redondance a chaque niveau critique.',
        category: 'redundancy',
        affectedNodeIds: [nodeId],
        source: 'rule',
        confidence: 'medium',
        normativeReference: 'NIST SP 800-34 §3.4',
        effort: 'high',
      };
    },
  },
  {
    id: 'NO_MULTI_AZ_CRITICAL',
    title: 'Service critique sans Multi-AZ',
    priority: 'P1',
    category: 'redundancy',
    normativeReference: 'ISO 22301 §8.4.4',
    effort: 'medium',
    evaluate: (_graph, nodeId, attrs) => {
      const criticalityScore = Number(attrs.criticalityScore ?? 0);
      const metadata = attrs.metadata as Record<string, unknown> | undefined;
      const isMultiAZ = Boolean(metadata?.isMultiAZ);
      if (criticalityScore <= 70 || isMultiAZ) return null;
      return {
        id: `${nodeId}-NO_MULTI_AZ_CRITICAL`,
        priority: 'P1',
        title: 'Activer la redondance Multi-AZ',
        description: `${attrs.name} est critique (${criticalityScore}) sans couverture Multi-AZ.`,
        action: 'Activer Multi-AZ sur les composants critiques.',
        category: 'redundancy',
        affectedNodeIds: [nodeId],
        source: 'rule',
        confidence: 'high',
        normativeReference: 'ISO 22301 §8.4.4',
        effort: 'medium',
      };
    },
  },
  {
    id: 'PUBLIC_DATABASE',
    title: 'Base de donnees publiquement accessible',
    priority: 'P0',
    category: 'network',
    normativeReference: 'ISO 27001 A.13.1',
    effort: 'medium',
    evaluate: (_graph, nodeId, attrs) => {
      if (attrs.type !== 'DATABASE') return null;
      const metadata = attrs.metadata as Record<string, unknown> | undefined;
      if (!Boolean(metadata?.isPubliclyAccessible)) return null;
      return {
        id: `${nodeId}-PUBLIC_DATABASE`,
        priority: 'P0',
        title: 'Restreindre acces reseau a la base de donnees',
        description: `${attrs.name} semble exposee publiquement.`,
        action: 'Restreindre l acces aux sous-reseaux prives et filtrer via firewall/security groups.',
        category: 'network',
        affectedNodeIds: [nodeId],
        source: 'rule',
        confidence: 'high',
        normativeReference: 'ISO 27001 A.13.1',
        effort: 'medium',
      };
    },
  },
];

export function generateHybridRecommendations(graph: GraphInstance): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const nodeId of graph.nodes()) {
    const attrs = graph.getNodeAttributes(nodeId) as InfraNodeAttrs;
    for (const rule of RULES) {
      const recommendation = rule.evaluate(graph, nodeId, attrs);
      if (recommendation) recommendations.push(recommendation);
    }
  }

  const uniqueRegions = new Set<string>();
  let hasMonitoringNode = false;

  graph.forEachNode((_nodeId, attrs) => {
    const node = attrs as InfraNodeAttrs;
    if (node.region) uniqueRegions.add(node.region);
    const nodeType = String(node.type ?? '').toLowerCase();
    const nodeName = String(node.name ?? '').toLowerCase();
    if (nodeType.includes('monitor') || nodeName.includes('monitor') || nodeType.includes('observability')) {
      hasMonitoringNode = true;
    }
  });

  if (uniqueRegions.size === 1) {
    recommendations.push({
      id: 'GLOBAL-SINGLE_REGION',
      priority: 'P1',
      title: 'Infrastructure mono-region',
      description: 'Une seule region detectee dans le graphe.',
      action: 'Deployer les services critiques dans au moins 2 regions.',
      category: 'redundancy',
      affectedNodeIds: [],
      source: 'rule',
      confidence: 'high',
      normativeReference: 'ISO 22301 §8.4.4',
      effort: 'high',
    });
  }

  if (!hasMonitoringNode) {
    recommendations.push({
      id: 'GLOBAL-NO_MONITORING',
      priority: 'P1',
      title: 'Absence de monitoring centralise',
      description: 'Aucun noeud de monitoring/observabilite n a ete detecte.',
      action: 'Deployer monitoring + alerting sur les composants critiques.',
      category: 'monitoring',
      affectedNodeIds: [],
      source: 'rule',
      confidence: 'medium',
      normativeReference: 'ISO 27001 A.12.4',
      effort: 'medium',
    });
  }

  return recommendations.map((recommendation) => ({
    ...recommendation,
    description: enrichDescriptionWithAiStyle(recommendation),
    source: recommendation.source,
  }));
}

function computeMaxDepth(graph: GraphInstance, nodeId: string, visited: Set<string>): number {
  const neighbors = graph.outNeighbors(nodeId);
  if (neighbors.length === 0) return 1;

  let maxDepth = 1;
  for (const neighborId of neighbors) {
    if (visited.has(neighborId)) continue;
    const nextVisited = new Set(visited);
    nextVisited.add(neighborId);
    maxDepth = Math.max(maxDepth, 1 + computeMaxDepth(graph, neighborId, nextVisited));
  }

  return maxDepth;
}

function enrichDescriptionWithAiStyle(recommendation: Recommendation): string {
  const contextPrefix = recommendation.priority === 'P0'
    ? 'Impact potentiel critique.'
    : recommendation.priority === 'P1'
      ? 'Impact significatif sur la resilence.'
      : 'Amelioration conseillee pour fiabilite long terme.';

  return `${contextPrefix} ${recommendation.description}`;
}
