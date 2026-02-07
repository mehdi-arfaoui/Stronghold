// ============================================================
// Graph & Resilience Platform — Core Types
// ============================================================

// --- Node Types ---
export enum NodeType {
  // Cloud compute
  VM = 'VM',
  CONTAINER = 'CONTAINER',
  SERVERLESS = 'SERVERLESS',
  KUBERNETES_CLUSTER = 'KUBERNETES_CLUSTER',
  KUBERNETES_POD = 'KUBERNETES_POD',
  KUBERNETES_SERVICE = 'KUBERNETES_SERVICE',

  // Network
  VPC = 'VPC',
  SUBNET = 'SUBNET',
  LOAD_BALANCER = 'LOAD_BALANCER',
  API_GATEWAY = 'API_GATEWAY',
  CDN = 'CDN',
  DNS = 'DNS',
  FIREWALL = 'FIREWALL',

  // Storage & data
  DATABASE = 'DATABASE',
  CACHE = 'CACHE',
  OBJECT_STORAGE = 'OBJECT_STORAGE',
  FILE_STORAGE = 'FILE_STORAGE',
  MESSAGE_QUEUE = 'MESSAGE_QUEUE',

  // Application
  APPLICATION = 'APPLICATION',
  MICROSERVICE = 'MICROSERVICE',

  // Infrastructure
  REGION = 'REGION',
  AVAILABILITY_ZONE = 'AVAILABILITY_ZONE',
  DATA_CENTER = 'DATA_CENTER',

  // External
  THIRD_PARTY_API = 'THIRD_PARTY_API',
  SAAS_SERVICE = 'SAAS_SERVICE',

  // On-premise
  PHYSICAL_SERVER = 'PHYSICAL_SERVER',
  NETWORK_DEVICE = 'NETWORK_DEVICE',
}

// --- Edge Types ---
export enum EdgeType {
  RUNS_ON = 'RUNS_ON',
  CONNECTS_TO = 'CONNECTS_TO',
  DEPENDS_ON = 'DEPENDS_ON',
  ROUTES_TO = 'ROUTES_TO',
  CONTAINS = 'CONTAINS',
  REPLICATES_TO = 'REPLICATES_TO',
  BACKS_UP_TO = 'BACKS_UP_TO',
  AUTHENTICATES_VIA = 'AUTHENTICATES_VIA',
  MONITORS = 'MONITORS',
  PUBLISHES_TO = 'PUBLISHES_TO',
  SUBSCRIBES_TO = 'SUBSCRIBES_TO',
}

// --- Node Attributes (stored on graphology nodes) ---
export interface InfraNodeAttrs {
  id: string;
  externalId?: string | null;
  name: string;
  type: string;
  provider: string;
  region?: string | null;
  availabilityZone?: string | null;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  lastSeenAt?: Date | null;

  // Computed analysis scores
  criticalityScore?: number;
  redundancyScore?: number;
  blastRadius?: number;
  isSPOF?: boolean;
  isArticulationPoint?: boolean;
  betweennessCentrality?: number;
  dependentsCount?: number;
  dependenciesCount?: number;

  // BIA
  suggestedRTO?: number;
  suggestedRPO?: number;
  suggestedMTPD?: number;
  validatedRTO?: number;
  validatedRPO?: number;
  validatedMTPD?: number;
  impactCategory?: string;
  financialImpactPerHour?: number;
}

// --- Edge Attributes ---
export interface InfraEdgeAttrs {
  type: string;
  confidence: number;
  inferenceMethod?: string | null;
  confirmed: boolean;
  metadata?: Record<string, unknown>;
}

// --- Scan Results ---
export interface ScanResult {
  nodes: InfraNodeAttrs[];
  edges: ScanEdge[];
  provider: string;
  scannedAt: Date;
}

export interface ScanEdge {
  source: string; // node id or externalId
  target: string;
  type: string;
  confidence?: number;
  inferenceMethod?: string;
}

// --- Reconciliation ---
export interface ReconciliationReport {
  nodesCreated: number;
  nodesUpdated: number;
  nodesRemoved: number;
  edgesCreated: number;
  edgesUpdated: number;
  edgesRemoved: number;
}

export interface IngestReport extends ReconciliationReport {
  provider: string;
  scannedAt: Date;
  totalNodes: number;
  totalEdges: number;
}

// --- SPOF ---
export interface SPOFReport {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  blastRadius: number;
  impactedServices: string[];
  recommendation: string;
}

// --- Redundancy ---
export interface RedundancyCheck {
  check: string;
  passed: boolean;
  recommendation: string;
  impact: 'critical' | 'high' | 'medium' | 'low';
}

export interface RedundancyIssue {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  redundancyScore: number;
  failedChecks: RedundancyCheck[];
}

// --- Regional Risk ---
export interface RegionalRisk {
  region: string;
  concentration: number;
  totalNodes: number;
  criticalNodes: number;
  risk: 'critical' | 'high' | 'medium' | 'low';
  recommendation: string;
}

// --- Circular Dependency ---
export interface CircularDependency {
  nodes: Array<{ id: string; name: string }>;
  length: number;
}

// --- Cascade Node ---
export interface CascadeNode {
  id: string;
  name: string;
  type: string;
  status: 'down' | 'degraded';
  cascadeReason: string;
  cascadeDepth: number;
}

// --- Graph Analysis Report ---
export interface GraphAnalysisReport {
  timestamp: Date;
  totalNodes: number;
  totalEdges: number;
  spofs: SPOFReport[];
  criticalityScores: Map<string, number>;
  redundancyIssues: RedundancyIssue[];
  regionalRisks: RegionalRisk[];
  circularDeps: CircularDependency[];
  cascadeChains: CascadeChain[];
  resilienceScore: number;
}

export interface CascadeChain {
  sourceNodeId: string;
  sourceNodeName: string;
  depth: number;
  totalImpacted: number;
  impactedNodes: Array<{ id: string; name: string; depth: number }>;
}

// --- BIA Types ---
export interface BIAMetrics {
  rto: number;
  rpo: number;
  mtpd: number;
  mao: number;
  mbco: number;
  category: 'critical' | 'high' | 'medium' | 'low';
}

export interface WeakPoint {
  nodeId: string;
  nodeName: string;
  reason: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface FinancialImpact {
  estimatedCostPerHour: number;
  confidence: 'low' | 'medium' | 'high';
  note: string;
  breakdown: {
    directDependents: number;
    serviceType: string;
    multiplier: number;
  };
}

export interface BIAProcessResult {
  serviceNodeId: string;
  serviceName: string;
  serviceType: string;
  suggestedMAO: number;
  suggestedMTPD: number;
  suggestedRTO: number;
  suggestedRPO: number;
  suggestedMBCO: number;
  impactCategory: string;
  criticalityScore: number;
  recoveryTier: number;
  dependencyChain: Array<{ id: string; name: string; type: string; isSPOF: boolean }>;
  weakPoints: WeakPoint[];
  financialImpact: FinancialImpact;
  validationStatus: string;
}

export interface BIAReportResult {
  generatedAt: Date;
  processes: BIAProcessResult[];
  summary: {
    totalProcesses: number;
    tier1Count: number;
    tier2Count: number;
    tier3Count: number;
    tier4Count: number;
    totalEstimatedImpact: number;
  };
}

// --- Simulation Types ---
export interface SimulationScenario {
  scenarioType: string;
  params: Record<string, unknown>;
  name?: string;
}

export interface SimulationBusinessImpact {
  serviceId: string;
  serviceName: string;
  impact: 'total_outage' | 'degraded' | 'partial';
  estimatedRTO: number;
  estimatedRPO: number;
  financialImpactPerHour: number;
}

export interface SimulationResult {
  id: string;
  scenario: SimulationScenario;
  executedAt: Date;
  directlyAffected: Array<{ id: string; name: string; type: string; status: string }>;
  cascadeImpacted: CascadeNode[];
  businessImpact: SimulationBusinessImpact[];
  metrics: {
    totalNodesAffected: number;
    percentageInfraAffected: number;
    estimatedDowntimeMinutes: number;
    estimatedFinancialLoss: number;
    servicesWithTotalOutage: number;
    servicesWithDegradation: number;
  };
  recommendations: SimulationRecommendation[];
  postIncidentResilienceScore: number;
}

export interface SimulationRecommendation {
  title: string;
  description: string;
  priority: 'immediate' | 'planned' | 'strategic';
  effort: 'low' | 'medium' | 'high';
  estimatedRiskReduction: number;
}

// --- Risk Detection Types ---
export interface AutoDetectedRisk {
  id: string;
  category: 'infrastructure' | 'network' | 'application' | 'external';
  title: string;
  description: string;
  probability: number;
  impact: number;
  linkedNodeIds: string[];
  mitigations: Array<{
    title: string;
    effort: 'low' | 'medium' | 'high';
    priority: 'immediate' | 'planned' | 'strategic';
  }>;
  autoDetected: boolean;
  detectionMethod: string;
}

// --- Landing Zone Types ---
export interface RecoveryStrategy {
  type: 'active_active' | 'warm_standby' | 'pilot_light' | 'backup_restore';
  description: string;
  targetRTO: number;
  targetRPO: number;
  components: string[];
}

export interface LandingZoneItem {
  serviceId: string;
  serviceName: string;
  priorityScore: number;
  recoveryTier: number;
  strategy: RecoveryStrategy;
  estimatedCost: number;
  riskOfInaction: number;
  prerequisites: string[];
}

export interface LandingZoneReport {
  generatedAt: Date;
  recommendations: LandingZoneItem[];
  summary: {
    totalServices: number;
    tier1Count: number;
    estimatedTotalCost: number;
    estimatedRiskReduction: number;
  };
}

// --- Cloud Adapter Interface ---
export interface CloudAdapter {
  scan(config: unknown): Promise<ScanResult>;
}

// --- Scenario Templates ---
export interface ScenarioTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  params: Array<{
    name: string;
    type: string;
    options?: string | string[];
    optional?: boolean;
  }>;
}
