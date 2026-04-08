import type { ServicePosture } from '../services/service-posture-types.js';
import { buildServiceIndex, classifyResourceRole, resolveTagValue } from '../services/service-utils.js';
import type { ContextualFinding } from '../services/finding-types.js';
import type { Service } from '../services/service-types.js';
import type { InfraNode } from '../validation/validation-types.js';
import { allValidationRules } from '../validation/validation-rules.js';
import { collectNodeKinds, normalizeType } from '../validation/validation-node-utils.js';
import type { DRPolicy, PolicyViolation } from './policy-types.js';

const RULES_BY_ID = new Map(allValidationRules.map((rule) => [rule.id, rule] as const));

export function evaluatePolicies(
  policies: readonly DRPolicy[],
  findings: readonly ContextualFinding[],
  services: readonly Service[],
  nodes: readonly InfraNode[],
): readonly PolicyViolation[] {
  const serviceByNode = buildServiceIndex(services);
  const failureByRuleAndNode = new Map(
    findings.map((finding) => [`${finding.ruleId}::${finding.nodeId}`, finding] as const),
  );

  return policies.flatMap((policy) => {
    const rule = RULES_BY_ID.get(policy.rule);
    if (!rule) {
      return [];
    }

    return nodes.flatMap((node) => {
      const service = serviceByNode.get(node.id) ?? null;
      if (!matchesPolicyScope(policy, node, service)) {
        return [];
      }

      if (!isRuleApplicableToNode(rule.appliesToTypes, node)) {
        return [];
      }

      const finding = failureByRuleAndNode.get(`${policy.rule}::${node.id}`);
      if (!finding) {
        return [];
      }

      return [
        {
          policyId: policy.id,
          policyName: policy.name,
          findingKey: `${finding.ruleId}::${finding.nodeId}`,
          nodeId: finding.nodeId,
          ...(finding.serviceId ? { serviceId: finding.serviceId } : {}),
          severity: policy.severity,
          message: `${finding.nodeName} violates policy "${policy.name}" because ${policy.rule} failed within the configured scope.`,
        },
      ];
    });
  });
}

export function annotatePolicyViolations(
  findings: readonly ContextualFinding[],
  violations: readonly PolicyViolation[],
): readonly ContextualFinding[] {
  const violationsByFindingKey = new Map<string, PolicyViolation[]>();
  violations.forEach((violation) => {
    const existing = violationsByFindingKey.get(violation.findingKey) ?? [];
    existing.push(violation);
    violationsByFindingKey.set(violation.findingKey, existing);
  });

  return findings.map((finding) => {
    const findingKey = `${finding.ruleId}::${finding.nodeId}`;
    const findingViolations = violationsByFindingKey.get(findingKey);
    if (!findingViolations || findingViolations.length === 0) {
      return finding;
    }

    return {
      ...finding,
      policyViolations: findingViolations,
    };
  });
}

export function applyPoliciesToServicePosture(
  posture: ServicePosture,
  policies: readonly DRPolicy[],
  nodes: readonly InfraNode[],
): {
  readonly posture: ServicePosture;
  readonly violations: readonly PolicyViolation[];
} {
  const violations = evaluatePolicies(
    policies,
    posture.contextualFindings,
    posture.services.map((service) => service.service),
    nodes,
  );
  const contextualFindings = annotatePolicyViolations(posture.contextualFindings, violations);

  return {
    posture: {
      ...posture,
      contextualFindings,
      services: posture.services.map((service) => ({
        ...service,
        contextualFindings: contextualFindings.filter(
          (finding) => finding.serviceId === service.service.id,
        ),
      })),
      unassigned: {
        ...posture.unassigned,
        contextualFindings: contextualFindings.filter((finding) => finding.serviceId === null),
      },
    },
    violations,
  };
}

function matchesPolicyScope(
  policy: DRPolicy,
  node: InfraNode,
  service: Service | null,
): boolean {
  if (
    policy.appliesTo.serviceCriticality &&
    service?.criticality !== policy.appliesTo.serviceCriticality
  ) {
    return false;
  }

  if (policy.appliesTo.resourceRole) {
    const role =
      service?.resources.find((resource) => resource.nodeId === node.id)?.role ??
      classifyResourceRole(node);
    if (role !== policy.appliesTo.resourceRole) {
      return false;
    }
  }

  if (policy.appliesTo.serviceId && service?.id !== policy.appliesTo.serviceId) {
    return false;
  }

  if (policy.appliesTo.tag) {
    const tagValue = resolveTagValue(node, policy.appliesTo.tag.key);
    if (tagValue !== policy.appliesTo.tag.value) {
      return false;
    }
  }

  return true;
}

function isRuleApplicableToNode(
  appliesToTypes: readonly string[],
  node: InfraNode,
): boolean {
  const kinds = collectNodeKinds(node);
  return appliesToTypes.some((type) => kinds.has(normalizeType(type)));
}
