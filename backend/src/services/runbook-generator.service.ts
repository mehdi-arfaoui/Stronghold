import type { InfraNode, Simulation } from "@prisma/client";

type JsonRecord = Record<string, unknown>;
type ScenarioFamily =
  | "db_failure"
  | "ransomware"
  | "az_failure"
  | "region_failure"
  | "network_partition"
  | "dns_failure"
  | "third_party_outage"
  | "generic";

export type RunbookStepPhase = "detection" | "containment" | "recovery" | "validation" | "communication";
export type GeneratedRunbookStepType = "manual" | "automated" | "decision" | "notification";

export interface RunbookPropagationEvent {
  timestampMinutes: number;
  delaySeconds: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  impactType: string;
  impactSeverity: string;
  edgeType: string;
  parentNodeId: string | null;
  parentNodeName: string | null;
  description: string;
}

export interface RunbookContextNode {
  id: string;
  name: string;
  type: string;
  provider?: string;
  region?: string;
  availabilityZone?: string;
  tier?: number;
  impactedAtMinutes: number;
  impactedAtSeconds: number;
}

export interface GeneratedRunbookContext {
  simulationId: string;
  scenarioType: string;
  impactedNodes: RunbookContextNode[];
  propagationTimeline: RunbookPropagationEvent[];
  predictedRTO: number;
  predictedRPO: number;
}

export interface GeneratedRunbookStep {
  id: string;
  order: number;
  phase: RunbookStepPhase;
  title: string;
  description: string;
  serviceId: string;
  serviceName: string;
  type: GeneratedRunbookStepType;
  estimatedDurationMinutes: number;
  prerequisites: string[];
  validationCriteria: string;
  assignee?: string;
  assignedRole: string;
  commands?: string[];
  verificationCheck?: string;
  rollbackInstructions?: string;
}

export interface GenerateRunbookFromSimulationInput {
  simulation: Pick<Simulation, "id" | "name" | "scenarioType" | "scenarioParams" | "result" | "createdAt">;
  impactedNodes: Array<
    Pick<InfraNode, "id" | "name" | "type" | "provider" | "region" | "availabilityZone" | "metadata">
  >;
  title?: string | null;
  description?: string | null;
  responsible?: string | null;
  accountable?: string | null;
  consulted?: string | null;
  informed?: string | null;
}

export interface BuildRunbookContextInput {
  simulation: Pick<Simulation, "id" | "scenarioType" | "scenarioParams" | "result" | "createdAt">;
  impactedNodes?: Array<
    Pick<InfraNode, "id" | "name" | "type" | "provider" | "region" | "availabilityZone" | "metadata">
  >;
  steps?: unknown;
}

export interface GeneratedOperationalRunbook {
  title: string;
  description: string;
  steps: GeneratedRunbookStep[];
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
  predictedRTO: number;
  predictedRPO: number;
  context: GeneratedRunbookContext;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return fallback;
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "step";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function optionalStringField(key: "provider" | "region" | "availabilityZone", value: string | null | undefined) {
  return value ? { [key]: value } : {};
}

function optionalNumberField(key: "tier", value: number | undefined) {
  return typeof value === "number" ? { [key]: value } : {};
}

function buildSeedNode(input: {
  id: string;
  name: string;
  type: string;
  provider: string | null | undefined;
  region: string | null | undefined;
  availabilityZone: string | null | undefined;
  tier: number | undefined;
}): Omit<RunbookContextNode, "impactedAtMinutes" | "impactedAtSeconds"> {
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    ...optionalStringField("provider", input.provider),
    ...optionalStringField("region", input.region),
    ...optionalStringField("availabilityZone", input.availabilityZone),
    ...optionalNumberField("tier", input.tier),
  };
}

function extractTier(metadata: unknown): number | undefined {
  const raw = asRecord(metadata).tier ?? asRecord(metadata).recoveryTier ?? asRecord(metadata).criticalityTier;
  const value = Math.round(asNumber(raw, Number.NaN));
  return Number.isFinite(value) && value >= 1 && value <= 4 ? value : undefined;
}

function normalizeScenarioFamily(rawScenarioType: string): ScenarioFamily {
  const value = rawScenarioType.toLowerCase().replace(/[_\s]+/g, "-");
  if (["database-failure", "database-corruption", "db-failure"].includes(value)) return "db_failure";
  if (value.startsWith("ransomware")) return "ransomware";
  if (["az-loss", "availability-zone-loss", "az-failure"].includes(value)) return "az_failure";
  if (["region-loss", "complete-region-loss", "region-failure"].includes(value)) return "region_failure";
  if (["network-partition", "network-partition-split-brain"].includes(value)) return "network_partition";
  if (value === "dns-failure") return "dns_failure";
  if (["third-party-outage", "saas-provider-outage"].includes(value)) return "third_party_outage";
  return "generic";
}

function foundationWeight(nodeType: string): number {
  if (["REGION", "AVAILABILITY_ZONE", "VPC", "SUBNET", "FIREWALL"].includes(nodeType)) return 5;
  if (["DATABASE", "CACHE", "OBJECT_STORAGE", "DNS"].includes(nodeType)) return 4;
  if (nodeType === "MESSAGE_QUEUE") return 3;
  if (["APPLICATION", "MICROSERVICE", "VM", "CONTAINER", "KUBERNETES_CLUSTER", "SERVERLESS"].includes(nodeType)) return 2;
  if (["LOAD_BALANCER", "API_GATEWAY", "CDN"].includes(nodeType)) return 1;
  return 0;
}

function buildCloudCommand(node: Pick<RunbookContextNode, "name" | "type" | "provider" | "region">): string[] {
  const provider = asString(node.provider).toLowerCase();
  const region = node.region || "<region>";
  if (provider === "aws") {
    return node.type === "DATABASE"
      ? [
          `aws rds failover-db-cluster --db-cluster-identifier ${node.name}`,
          `aws rds describe-db-clusters --db-cluster-identifier ${node.name} --region ${region}`,
        ]
      : [
          `aws cloudwatch describe-alarms --region ${region}`,
          `aws autoscaling start-instance-refresh --auto-scaling-group-name ${node.name} --region ${region}`,
        ];
  }
  if (provider === "azure") return [`az monitor metrics list --resource ${node.name}`, `az vm restart --name ${node.name} --resource-group <resource-group>`];
  if (provider === "gcp") return [`gcloud compute instances describe ${node.name}`, `gcloud compute instances reset ${node.name} --zone <zone>`];
  return [`kubectl get pods -A | findstr ${node.name}`, `kubectl rollout restart deployment/${node.name} -n <namespace>`];
}

function extractPropagationTimeline(result: unknown): RunbookPropagationEvent[] {
  const timeline = asArray(asRecord(asRecord(result).warRoomData).propagationTimeline);
  return timeline
    .map((item) => {
      const record = asRecord(item);
      const nodeId = asString(record.nodeId);
      if (!nodeId) return null;
      const delaySeconds = Math.max(0, Math.round(asNumber(record.delaySeconds, asNumber(record.timestampMinutes, 0) * 60)));
      return {
        timestampMinutes: Math.max(0, asNumber(record.timestampMinutes, delaySeconds / 60)),
        delaySeconds,
        nodeId,
        nodeName: asString(record.nodeName, nodeId),
        nodeType: asString(record.nodeType, "unknown"),
        impactType: asString(record.impactType, "unknown"),
        impactSeverity: asString(record.impactSeverity, "major"),
        edgeType: asString(record.edgeType, "dependency"),
        parentNodeId: asString(record.parentNodeId) || null,
        parentNodeName: asString(record.parentNodeName) || null,
        description: asString(record.description, "Propagation event"),
      } satisfies RunbookPropagationEvent;
    })
    .filter((item): item is RunbookPropagationEvent => Boolean(item))
    .sort((left, right) => left.delaySeconds - right.delaySeconds || left.nodeName.localeCompare(right.nodeName));
}

function parseStoredSteps(steps: unknown): Array<{ serviceId: string; serviceName: string }> {
  return asArray(steps)
    .map((item) => {
      const record = asRecord(item);
      return { serviceId: asString(record.serviceId), serviceName: asString(record.serviceName) };
    })
    .filter((step) => step.serviceId.length > 0);
}

function phaseCopy(family: ScenarioFamily, simulationName: string, rootNode: RunbookContextNode, nodes: RunbookContextNode[], scenarioParams: JsonRecord) {
  const names = nodes.slice(0, 5).map((node) => node.name).join(", ") || rootNode.name;
  const region = asString(scenarioParams.region, rootNode.region || "<region>");
  const az = asString(scenarioParams.az, rootNode.availabilityZone || rootNode.region || "<az>");
  switch (family) {
    case "db_failure":
      return {
        detection: `Verifier alertes DB, connectivite et replication autour de ${rootNode.name}.`,
        containment: `Basculer ${rootNode.name} sur une cible saine et mettre les dependants en graceful degradation.`,
        validation: `Verifier replication, reconnexion des services dependants et transactions critiques pour ${names}.`,
        communication: `Interne: panne DB confirmee. Clients: degradation possible pendant la bascule. Management: checkpoints RTO/RPO partages.`,
      };
    case "ransomware":
      return {
        detection: `Isoler les instances suspectes, capturer les logs de securite et verifier les backups propres pour ${names}.`,
        containment: `Couper les acces reseau, revoquer les secrets compromis et geler les changements sur ${simulationName}.`,
        validation: `Verifier integrite, scans EDR et restauration depuis un backup clean avant reouverture du trafic.`,
        communication: `Interne/legal/management synchronises; message client cadense sur l'etat forensique et la reprise.`,
      };
    case "az_failure":
      return {
        detection: `Confirmer la perte d'AZ ${az} via status page et health checks internes.`,
        containment: `Retirer ${az} du trafic actif et rediriger la capacite vers les zones saines.`,
        validation: `Verifier health checks, DNS et charge depuis les zones saines pour ${names}.`,
        communication: `Informer sur la bascule AZ, la capacite restante et les risques de surcharge temporaires.`,
      };
    case "region_failure":
      return {
        detection: `Confirmer la perte de region ${region} via status page provider et checks cross-region.`,
        containment: `Retirer ${region} du trafic, rediriger DNS et activer le standby dans la region de secours.`,
        validation: `Verifier endpoints, DNS, replication et parcours metiers apres bascule pour ${names}.`,
        communication: `Partager le statut regional, l'ETA de propagation DNS et la capacite post-bascule.`,
      };
    case "network_partition":
      return {
        detection: `Confirmer la partition reseau, le risque de split-brain et les segments touches autour de ${rootNode.name}.`,
        containment: `Bloquer les ecritures incoherentes et figer le leader tant que le quorum n'est pas stabilise.`,
        validation: `Verifier quorum, replication et absence de divergence de donnees sur ${names}.`,
        communication: `Partager les restrictions de coherence et le plan de reouverture progressive.`,
      };
    case "dns_failure":
      return {
        detection: `Confirmer la defaillance DNS via resolvers multiples et tests end-to-end sur ${rootNode.name}.`,
        containment: `Basculer les enregistrements critiques et suivre la propagation TTL.`,
        validation: `Verifier resolution, certificats et endpoints applicatifs pour ${names}.`,
        communication: `Informer sur la propagation DNS et les zones encore susceptibles d'etre degradees.`,
      };
    case "third_party_outage":
      return {
        detection: `Confirmer la panne du fournisseur tiers et les workflows metiers relies a ${rootNode.name}.`,
        containment: `Activer le provider secondaire ou le mode degrade pour les parcours critiques.`,
        validation: `Verifier fallback, files d'attente et transactions critiques pour ${names}.`,
        communication: `Communiquer clairement la dependance tierce, le fallback actif et l'ETA fournisseur.`,
      };
    default:
      return {
        detection: `Confirmer l'incident ${simulationName} sur monitoring, logs et health checks pour ${names}.`,
        containment: `Limiter le blast radius, drainer le trafic risque et activer le mode degrade.`,
        validation: `Executer les checks techniques et fonctionnels sur ${names}.`,
        communication: `Synchroniser le scope, le plan de reprise et le prochain checkpoint avec tous les stakeholders.`,
      };
  }
}

function recoveryAction(node: RunbookContextNode, family: ScenarioFamily): Omit<GeneratedRunbookStep, "id" | "order" | "phase" | "prerequisites"> {
  const commands = dedupe(buildCloudCommand(node));
  const assignee =
    family === "ransomware"
      ? "Security Operations"
      : node.type === "DATABASE"
        ? "DBA"
        : ["DNS", "LOAD_BALANCER", "API_GATEWAY"].includes(node.type)
          ? "Network Operations"
          : "SRE / Platform";
  const duration = Math.max(8, 12 + foundationWeight(node.type) * 3 + (family === "ransomware" ? 8 : 0));

  if (family === "db_failure" && node.type === "DATABASE") {
    return {
      title: `Basculer ${node.name} vers un replica sain`,
      description: `Promouvoir la base avant de reconnecter les services dependants a ${node.name}.`,
      serviceId: node.id,
      serviceName: node.name,
      type: "automated",
      estimatedDurationMinutes: duration,
      validationCriteria: "Replica promu, replication OK et ecritures valides.",
      assignee,
      assignedRole: assignee,
      commands: [...commands, `echo "Verifier replication et write path de ${node.name}"`],
      verificationCheck: "Replica promu, replication OK et ecritures valides.",
      rollbackInstructions: "Si la promotion echoue, revenir au dernier snapshot valide et maintenir les dependances en mode degrade.",
    };
  }

  if (family === "ransomware") {
    return {
      title: `Restaurer ${node.name} depuis une source saine`,
      description: `Reprovisionner ou restaurer ${node.name}, puis tourner secrets et controles d'integrite.`,
      serviceId: node.id,
      serviceName: node.name,
      type: "automated",
      estimatedDurationMinutes: duration,
      validationCriteria: "Asset propre, IOC absents et secrets tournes.",
      assignee,
      assignedRole: assignee,
      commands: [`echo "Restaurer ${node.name} depuis un backup clean"`, `echo "Tourner les credentials associes a ${node.name}"`, ...commands],
      verificationCheck: "Asset propre, IOC absents et secrets tournes.",
      rollbackInstructions: "Ne pas reconnecter le noeud tant que les controles forensiques restent incomplets.",
    };
  }

  if (family === "az_failure") {
    return {
      title: `Relancer ${node.name} hors de l'AZ affectee`,
      description: `Replacer ${node.name} dans une AZ saine puis valider sa capacite.`,
      serviceId: node.id,
      serviceName: node.name,
      type: "automated",
      estimatedDurationMinutes: duration,
      validationCriteria: "Noeud present dans une AZ saine et traffic stable.",
      assignee,
      assignedRole: assignee,
      commands: [`echo "Verifier placement de ${node.name} hors AZ en defaut"`, ...commands],
      verificationCheck: "Noeud present dans une AZ saine et traffic stable.",
      rollbackInstructions: "Si la capacite reste insuffisante, maintenir le mode degrade et prioriser les services T1.",
    };
  }

  if (family === "region_failure") {
    return {
      title: `Promouvoir ${node.name} dans la region de secours`,
      description: `Executer la bascule cross-region pour ${node.name} puis verifier endpoints et DNS.`,
      serviceId: node.id,
      serviceName: node.name,
      type: "automated",
      estimatedDurationMinutes: duration + 6,
      validationCriteria: "Region secondaire active, endpoints publics resolvent correctement et donnees critiques coherentes.",
      assignee,
      assignedRole: assignee,
      commands: [`echo "Promouvoir ${node.name} dans la region secondaire"`, ...commands],
      verificationCheck: "Region secondaire active, endpoints publics resolvent correctement et donnees critiques coherentes.",
      rollbackInstructions: "Limiter le scope aux services T1 si la region de secours est contrainte.",
    };
  }

  return {
    title: `Restaurer ${node.name}`,
    description: `Traiter ${node.name} selon l'ordre inverse de propagation, des fondations vers les dependants.`,
    serviceId: node.id,
    serviceName: node.name,
    type: "automated",
    estimatedDurationMinutes: duration,
    validationCriteria: `${node.name} est sain et ses checks applicatifs sont verts.`,
    assignee,
    assignedRole: assignee,
    commands: [...commands, `echo "Verifier dependances en aval de ${node.name}"`],
    verificationCheck: `${node.name} est sain et ses checks applicatifs sont verts.`,
    rollbackInstructions: "Revenir a l'etat stable precedent si le noeud n'est pas conforme.",
  };
}

function createStep(step: Omit<GeneratedRunbookStep, "order">): GeneratedRunbookStep {
  return { ...step, order: 0, prerequisites: dedupe(step.prerequisites) };
}

export const RunbookGeneratorService = {
  extractImpactedNodeIds(result: unknown): string[] {
    const payload = asRecord(result);
    return Array.from(
      new Set(
        [...asArray(payload.directlyAffected), ...asArray(payload.cascadeImpacted)]
          .map((item) => asString(asRecord(item).id))
          .filter(Boolean),
      ),
    );
  },

  extractPredictedRTO(result: unknown): number {
    return Math.max(1, asNumber(asRecord(asRecord(result).metrics).estimatedDowntimeMinutes, 240));
  },

  extractPredictedRPO(result: unknown): number {
    const rpos = asArray(asRecord(result).businessImpact)
      .map((entry) => asNumber(asRecord(entry).estimatedRPO, Number.NaN))
      .filter((value) => Number.isFinite(value) && value > 0);
    return rpos.length > 0 ? Math.max(1, Math.round(rpos.reduce((sum, value) => sum + value, 0) / rpos.length)) : 60;
  },

  buildContext(input: BuildRunbookContextInput): GeneratedRunbookContext {
    const timeline = extractPropagationTimeline(input.simulation.result);
    const predictedRTO = this.extractPredictedRTO(input.simulation.result);
    const predictedRPO = this.extractPredictedRPO(input.simulation.result);
    const seeds = new Map<string, Omit<RunbookContextNode, "impactedAtMinutes" | "impactedAtSeconds">>();

    for (const node of input.impactedNodes ?? []) {
      seeds.set(node.id, buildSeedNode({
        id: node.id,
        name: node.name,
        type: node.type,
        provider: node.provider,
        region: node.region,
        availabilityZone: node.availabilityZone,
        tier: extractTier(node.metadata),
      }));
    }

    for (const item of [...asArray(asRecord(input.simulation.result).directlyAffected), ...asArray(asRecord(input.simulation.result).cascadeImpacted)]) {
      const record = asRecord(item);
      const id = asString(record.id);
      if (!id) continue;
      const existing = seeds.get(id);
      seeds.set(id, buildSeedNode({
        id,
        name: asString(record.name, existing?.name || id),
        type: asString(record.type, existing?.type || "unknown"),
        provider: existing?.provider,
        region: existing?.region,
        availabilityZone: existing?.availabilityZone,
        tier: existing?.tier,
      }));
    }

    for (const event of timeline) {
      const existing = seeds.get(event.nodeId);
      seeds.set(event.nodeId, buildSeedNode({
        id: event.nodeId,
        name: existing?.name || event.nodeName,
        type: existing?.type || event.nodeType,
        provider: existing?.provider,
        region: existing?.region,
        availabilityZone: existing?.availabilityZone,
        tier: existing?.tier,
      }));
    }

    for (const step of parseStoredSteps(input.steps)) {
      const existing = seeds.get(step.serviceId);
      seeds.set(step.serviceId, buildSeedNode({
        id: step.serviceId,
        name: step.serviceName || existing?.name || step.serviceId,
        type: existing?.type || "unknown",
        provider: existing?.provider,
        region: existing?.region,
        availabilityZone: existing?.availabilityZone,
        tier: existing?.tier,
      }));
    }

    const impactedNodes = Array.from(seeds.values())
      .map((node, index) => {
        const event = timeline.find((entry) => entry.nodeId === node.id);
        return {
          ...node,
          impactedAtMinutes: event?.timestampMinutes ?? index,
          impactedAtSeconds: event?.delaySeconds ?? index * 60,
        } satisfies RunbookContextNode;
      })
      .sort((left, right) => left.impactedAtSeconds - right.impactedAtSeconds || left.name.localeCompare(right.name));

    return { simulationId: input.simulation.id, scenarioType: input.simulation.scenarioType, impactedNodes, propagationTimeline: timeline, predictedRTO, predictedRPO };
  },

  generateFromSimulation(input: GenerateRunbookFromSimulationInput): GeneratedOperationalRunbook {
    const simulationName = input.simulation.name || input.simulation.scenarioType;
    const context = this.buildContext({ simulation: input.simulation, impactedNodes: input.impactedNodes });
    const family = normalizeScenarioFamily(input.simulation.scenarioType);
    const nodes = [...context.impactedNodes];
    const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
    const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
    const children = new Map<string, Set<string>>(nodes.map((node) => [node.id, new Set<string>()]));

    context.propagationTimeline.forEach((event) => {
      if (!event.parentNodeId || !nodeMap.has(event.parentNodeId) || !nodeMap.has(event.nodeId)) return;
      const childSet = children.get(event.parentNodeId);
      if (!childSet || childSet.has(event.nodeId)) return;
      childSet.add(event.nodeId);
      indegree.set(event.nodeId, (indegree.get(event.nodeId) || 0) + 1);
    });

    const sorter = (left: RunbookContextNode, right: RunbookContextNode) =>
      left.impactedAtSeconds - right.impactedAtSeconds ||
      (left.tier ?? 9) - (right.tier ?? 9) ||
      foundationWeight(right.type) - foundationWeight(left.type) ||
      left.name.localeCompare(right.name);

    const queue = nodes.filter((node) => (indegree.get(node.id) || 0) === 0).sort(sorter);
    const orderedRecovery: RunbookContextNode[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      orderedRecovery.push(current);
      Array.from(children.get(current.id) || [])
        .map((id) => nodeMap.get(id))
        .filter((node): node is RunbookContextNode => Boolean(node))
        .forEach((node) => {
          const next = (indegree.get(node.id) || 0) - 1;
          indegree.set(node.id, next);
          if (next === 0) queue.push(node);
        });
      queue.sort(sorter);
    }

    const rootNode = orderedRecovery[0] || context.impactedNodes[0] || { id: `simulation-${input.simulation.id}`, name: simulationName, type: "INCIDENT", impactedAtMinutes: 0, impactedAtSeconds: 0 };
    const copy = phaseCopy(family, simulationName, rootNode, context.impactedNodes, asRecord(input.simulation.scenarioParams));
    const steps: GeneratedRunbookStep[] = [];

    const detection = createStep({ id: `detection-${toSlug(rootNode.name)}`, phase: "detection", title: "Detection", description: copy.detection, serviceId: rootNode.id, serviceName: rootNode.name, type: "decision", estimatedDurationMinutes: 10, prerequisites: [], validationCriteria: "Incident confirme par monitoring, logs et checks independants.", assignee: "SRE On-Call", assignedRole: "SRE On-Call", commands: [`echo "Confirmer incident ${simulationName}"`], verificationCheck: "Incident confirme par monitoring, logs et checks independants." });
    const containment = createStep({ id: `containment-${toSlug(rootNode.name)}`, phase: "containment", title: "Containment", description: copy.containment, serviceId: rootNode.id, serviceName: rootNode.name, type: family === "ransomware" ? "manual" : "automated", estimatedDurationMinutes: family === "ransomware" ? 20 : 15, prerequisites: [detection.id], validationCriteria: "Le blast radius est stabilise et aucune nouvelle propagation majeure n'est observee.", assignee: family === "ransomware" ? "Security Operations" : "Incident Commander", assignedRole: family === "ransomware" ? "Security Operations" : "Incident Commander", commands: [`echo "Activer confinement pour ${simulationName}"`], verificationCheck: "Le blast radius est stabilise et aucune nouvelle propagation majeure n'est observee." });
    steps.push(detection, containment);

    const recoveryStepIds = new Map<string, string>();
    (orderedRecovery.length > 0 ? orderedRecovery : [rootNode]).forEach((node) => {
      const template = recoveryAction(node, family);
      const parentPrereqs = context.propagationTimeline
        .filter((event) => event.nodeId === node.id && event.parentNodeId)
        .map((event) => recoveryStepIds.get(event.parentNodeId || ""))
        .filter((id): id is string => Boolean(id));
      const step = createStep({ ...template, id: `recovery-${toSlug(node.id)}`, phase: "recovery", prerequisites: [containment.id, ...parentPrereqs] });
      recoveryStepIds.set(node.id, step.id);
      steps.push(step);
    });

    const validation = createStep({ id: "validation-end-to-end", phase: "validation", title: "Validation", description: copy.validation, serviceId: rootNode.id, serviceName: rootNode.name, type: "decision", estimatedDurationMinutes: 20, prerequisites: steps.filter((step) => step.phase === "recovery").map((step) => step.id), validationCriteria: "Les checks techniques et fonctionnels sont passes et les indicateurs reviennent sous seuil.", assignee: "Service Owner / QA", assignedRole: "Service Owner / QA", commands: [`echo "Executer smoke tests post-reprise"`], verificationCheck: "Les checks techniques et fonctionnels sont passes et les indicateurs reviennent sous seuil." });
    const communication = createStep({ id: "communication-stakeholders", phase: "communication", title: "Communication", description: copy.communication, serviceId: rootNode.id, serviceName: rootNode.name, type: "notification", estimatedDurationMinutes: 10, prerequisites: [detection.id, containment.id, validation.id], validationCriteria: "Les stakeholders disposent du scope, du plan et du prochain checkpoint.", assignee: "Incident Manager", assignedRole: "Incident Manager", commands: [`echo "Diffuser communication incident ${simulationName}"`], verificationCheck: "Les stakeholders disposent du scope, du plan et du prochain checkpoint." });
    steps.push(validation, communication);

    const ordered = steps.map((step, index) => ({ ...step, order: index + 1 }));
    return {
      title: input.title?.trim() || `Runbook - ${simulationName}`,
      description: input.description?.trim() || `Runbook operationnel contextuel genere depuis la simulation ${simulationName} du ${input.simulation.createdAt.toISOString()}.`,
      steps: ordered,
      responsible: input.responsible?.trim() || "Cloud Operations",
      accountable: input.accountable?.trim() || "Head of Infrastructure",
      consulted: input.consulted?.trim() || "Security & Architecture",
      informed: input.informed?.trim() || "Executive Stakeholders",
      predictedRTO: context.predictedRTO,
      predictedRPO: context.predictedRPO,
      context,
    };
  },
};
