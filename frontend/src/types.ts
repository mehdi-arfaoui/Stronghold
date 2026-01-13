export type ApiConfig = {
  backendUrl: string;
  apiKey: string;
};

export type Continuity = {
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  notes: string | null;
};

export type InfraLink = {
  infra: {
    name: string;
    type: string;
    provider: string | null;
    location: string | null;
  };
};

export type Service = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  criticality: string;
  recoveryPriority: number | null;
  domain?: string | null;
  continuity: Continuity | null;
  infraLinks: InfraLink[];
};

export type BackupStrategy = {
  id: string;
  serviceId: string | null;
  service?: {
    id: string;
    name: string;
    criticality: string;
  } | null;
  type: string;
  frequencyMinutes: number;
  retentionDays: number;
  storageLocation?: string | null;
  encryptionLevel?: string | null;
  compression: boolean;
  immutability: boolean;
  rtoImpactHours?: number | null;
  rpoImpactMinutes?: number | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SecurityPolicyServiceLink = {
  id: string;
  serviceId: string;
  service: {
    id: string;
    name: string;
    criticality: string;
  };
};

export type SecurityPolicy = {
  id: string;
  name: string;
  policyType: string;
  classification?: string | null;
  scope?: string | null;
  controls?: string | null;
  reviewFrequencyDays?: number | null;
  owner?: string | null;
  services: SecurityPolicyServiceLink[];
  createdAt?: string;
  updatedAt?: string;
};

export type DependencyCycleServiceLink = {
  id: string;
  serviceId: string;
  roleInCycle?: string | null;
  service: {
    id: string;
    name: string;
    criticality: string;
  };
};

export type DependencyCycle = {
  id: string;
  label: string;
  severity?: string | null;
  notes?: string | null;
  services: DependencyCycleServiceLink[];
  createdAt?: string;
  updatedAt?: string;
};

export type RiskMitigation = {
  id: string;
  description: string;
  owner?: string | null;
  status?: string | null;
  dueDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Risk = {
  id: string;
  title: string;
  description?: string | null;
  threatType: string;
  probability: number;
  impact: number;
  score: number;
  level: string;
  status?: string | null;
  owner?: string | null;
  processName?: string | null;
  serviceId?: string | null;
  service?: {
    id: string;
    name: string;
    criticality: string;
  } | null;
  mitigations: RiskMitigation[];
};

export type RiskSummary = {
  meta: { tenantId: string };
  totals: {
    count: number;
    byLevel: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    mitigationCoverage: number;
  };
  priorities: Array<{
    id: string;
    title: string;
    score: number;
    level: string;
    probability: number;
    impact: number;
    status?: string | null;
    owner?: string | null;
    serviceName?: string | null;
    processName?: string | null;
    mitigations: number;
  }>;
};
export type BusinessProcessServiceLink = {
  id: string;
  serviceId: string;
  service: {
    id: string;
    name: string;
    criticality: string;
  };
};

export type BusinessProcess = {
  id: string;
  name: string;
  description?: string | null;
  owners?: string | null;
  financialImpactLevel: number;
  regulatoryImpactLevel: number;
  interdependencies?: string | null;
  rtoHours: number;
  rpoMinutes: number;
  mtpdHours: number;
  impactScore: number;
  criticalityScore: number;
  services: BusinessProcessServiceLink[];
  createdAt?: string;
  updatedAt?: string;
};

export type RiskMatrixCell = {
  probability: number;
  impact: number;
  score: number;
  level: string;
  count: number;
  risks: Array<{
    id: string;
    title: string;
    score: number;
    level: string;
    serviceName?: string | null;
    processName?: string | null;
  }>;
};

export type RiskMatrixResponse = {
  meta: { tenantId: string };
  scale: { probability: number[]; impact: number[] };
  cells: RiskMatrixCell[];
  totalRisks: number;
};

export type BiaSummary = {
  meta: { tenantId: string };
  totals: {
    processes: number;
    linkedServices: number;
  };
  averages: {
    impactScore: number;
    timeScore: number;
    criticalityScore: number;
  };
  priorities: Array<{
    id: string;
    name: string;
    impactScore: number;
    timeScore: number;
    criticalityScore: number;
    rtoHours: number;
    rpoMinutes: number;
    mtpdHours: number;
    services: string[];
  }>;
  matrix: {
    impactScale: number[];
    timeScale: number[];
    cells: Array<{
      impact: number;
      time: number;
      count: number;
      processes: Array<{ id: string; name: string; criticalityScore: number }>;
    }>;
  };
};

export type AppWarning = {
  type: string;
  service: string;
  dependsOn: string;
  message: string;
};

export type NextActionItem = {
  key: "services_without_rto" | "scenarios_without_steps" | "documents_without_extraction";
  label: string;
  count: number;
  description: string;
};

export type NextActionsResponse = {
  items: NextActionItem[];
  totalPending: number;
};

export type InfraFinding = {
  type: string;
  infra: string;
  infraType: string;
  location?: string | null;
  message: string;
};

export type DiscoveryJob = {
  id: string;
  status: string;
  jobType: string;
  progress: number;
  parameters?: {
    ipRanges?: string[];
    cloudProviders?: string[];
    filename?: string;
    contentType?: string;
  } | null;
  resultSummary?: {
    discoveredHosts?: number;
    createdServices?: number;
    createdInfra?: number;
    createdDependencies?: number;
    createdInfraLinks?: number;
    ignoredEdges?: number;
    importReport?: {
      rejectedRows: number;
      rejectedEntries: {
        line: number;
        recordType: "node" | "edge" | "unknown";
        reasons: string[];
      }[];
    };
  } | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type DiscoverySuggestion = {
  externalId: string;
  name: string;
  kind: "service" | "infra";
  type: string;
  match?: {
    id: string;
    name: string;
    score: number;
    rtoHours: number | null;
    rpoMinutes: number | null;
    mtpdHours: number | null;
  } | null;
};

export type DiscoverySuggestionResponse = {
  summary: {
    totalNodes: number;
    serviceNodes: number;
    infraNodes: number;
    edges: number;
  };
  suggestions: DiscoverySuggestion[];
};

export type GraphNode = {
  id: string;
  label: string;
  summaryLabel?: string;
  detailPayload?: {
    name: string;
    type: string | null;
    category: string;
    criticality: string;
    businessPriority: number | null;
    domain: string | null;
    isLandingZone: boolean;
    rtoHours: number | null;
    rpoMinutes: number | null;
    mtpdHours: number | null;
    dependsOnCount: number;
    usedByCount: number;
  };
  type: string;
  nodeKind?: "service" | "application";
  category?: string;
  businessPriority?: number | null;
  domain?: string | null;
  isLandingZone?: boolean;
  dependsOnCount?: number;
  usedByCount?: number;
  criticality: string;
  rtoHours: number | null;
  rpoMinutes: number | null;
  mtpdHours: number | null;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
  edgeLabelShort?: string;
  edgeLabelLong?: string;
  strength?: string;
  edgeWeight?: number;
  edgeKind?: string;
};

export type GraphApiResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  views?: {
    categories?: Array<{
      category: string;
      serviceCount: number;
      averageCriticality: string;
      dependencies: Array<{ target: string; count: number }>;
    }>;
  };
  categories?: Array<{
    category: string;
    serviceCount?: number;
    count?: number;
    averageCriticality: string;
    dependencies?: Array<{ target: string; count: number }>;
  }>;
};

export type InfraComponent = {
  id: string;
  name: string;
  type: string;
  provider: string | null;
  location: string | null;
  criticality: string | null;
  isSingleAz: boolean;
  notes: string | null;
  services?: {
    service: {
      id: string;
      name: string;
      criticality: string;
    };
  }[];
};

export type ScenarioServiceLinkFront = {
  service: {
    id: string;
    name: string;
    criticality: string;
  };
};

export type ScenarioCatalogFront = {
  id: string;
  sourceKey: string;
  name: string;
  type: string;
  description?: string | null;
  impactLevel?: string | null;
  rtoTargetHours?: number | null;
  recoveryStrategy: string;
  estimatedCostLevel?: string | null;
  estimatedCostMin?: number | null;
  estimatedCostMax?: number | null;
  estimatedCostCurrency?: string | null;
};

export type RunbookStepFront = {
  id: string;
  order: number;
  title: string;
  description: string | null;
  estimatedDurationMinutes: number | null;
  role: string | null;
  blocking: boolean;
};

export type ScenarioFront = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  impactLevel: string | null;
  rtoTargetHours: number | null;
  services: ScenarioServiceLinkFront[];
  steps: RunbookStepFront[];
  catalogScenario?: ScenarioCatalogFront | null;
};

export type DocumentMetadata = {
  services: string[];
  slas: string[];
  rtoHours?: number;
  rpoMinutes?: number;
  mtpdHours?: number;
  backupMentions?: string[];
  dependencies?: string[];
  structuredSummary?: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type DocumentRecord = {
  id: string;
  originalName: string;
  docType?: string | null;
  detectedDocType?: string | null;
  detectedMetadata?: DocumentMetadata | string | null;
  description?: string | null;
  ingestionStatus?: string | null;
  ingestionError?: string | null;
  extractionStatus?: string | null;
  extractionError?: string | null;
  storagePath?: string | null;
  signedUrl?: string | null;
  size?: number | null;
  mimeType?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ExtractedFactFront = {
  id: string;
  documentId: string;
  type: string;
  category: string;
  label: string;
  data: Record<string, unknown>;
  source?: string | null;
  confidence?: number | null;
  createdAt?: string;
};

export type RagChunkFront = {
  documentId: string;
  documentName: string;
  documentType?: string | null;
  score: number;
  text: string;
};

export type RagFactFront = {
  id: string;
  documentId: string;
  label: string;
  category: string;
  dataPreview: string;
  confidence?: number | null;
  score: number;
};

export type RagContextFront = {
  chunks: RagChunkFront[];
  extractedFacts: RagFactFront[];
};

export type RagResponse = {
  question: string;
  context: RagContextFront;
  prompt: string;
  promptSize: number;
  draftAnswer: string;
  usedDocumentIds: string[];
};

export type RagScenarioFront = {
  scenarioId: string;
  name: string;
  reason: string[];
  score: number;
  matchedServices: string[];
};

export type CostEstimate = {
  capex: number;
  opexMonthly: number;
  currency: string;
};

export type PraRagReport = {
  prompt: string;
  promptSize: number;
  context: RagContextFront;
  draftAnswer: string;
  scenarioRecommendations: RagScenarioFront[];
  usedDocumentIds: string[];
};

export type DrRecommendationFront = {
  scenario: {
    id: string;
    label: string;
    description: string;
    rtoRangeHours: [number, number];
    rpoRangeMinutes: [number, number];
    cost: CostEstimate;
    complexity: string;
    suitableFor: string[];
    notes: string;
  };
  score: number;
  matchLevel: "strong" | "medium" | "weak";
  rationale: string[];
  justification: string;
};

export type PraDashboard = {
  meta: {
    tenantId: string;
    targetRtoHours: number;
    targetRpoMinutes: number;
    globalCriticality: string;
  };
  warnings: AppWarning[];
  infraFindings: InfraFinding[];
  compliance: {
    coverage: {
      bia: number;
      risks: number;
      incidents: number;
      exercises: number;
    };
    overallScore: number;
    totals: {
      services: number;
      processes: number;
      risks: number;
      incidents: number;
      exercises: number;
    };
    highlights: string[];
  };
  dr: {
    recommendations: DrRecommendationFront[];
    comparison: Array<{
      id: string;
      label: string;
      rto: string;
      rpo: string;
      cost: CostEstimate;
      complexity: string;
      description: string;
      notes: string;
    }>;
  };
  categories: Array<{ category: string; count: number; averageCriticality: string }>;
  rag: PraRagReport;
};

export type MaturityScore = {
  meta: {
    tenantId: string;
  };
  score: number;
  maxScore: number;
  level: "low" | "medium" | "high";
  breakdown: Array<{
    key: "rto_rpo" | "dependencies" | "scenarios" | "runbooks" | "backups";
    label: string;
    score: number;
    maxScore: number;
    coverage: number;
    details: string;
  }>;
  recommendations: string[];
  metrics: {
    totalServices: number;
    servicesWithContinuity: number;
    servicesWithDependencies: number;
    dependencyLinks: number;
    scenarioCount: number;
    runbookCount: number;
    servicesWithBackups: number;
    backupStrategies: number;
  };
};

export type RiskHeatmap = {
  meta: {
    tenantId: string;
    targetRtoHours: number;
    targetRpoMinutes: number;
    globalCriticality: string;
  };
  metrics: Array<{
    key: "rto" | "rpo";
    label: string;
    unit: "hours" | "minutes";
  }>;
  services: Array<{
    id: string;
    name: string;
    criticality: string;
  }>;
  data: Array<{
    serviceId: string;
    serviceName: string;
    criticality: string;
    metric: "rto" | "rpo";
    gap: number | null;
    gapRisk: number | null;
    score: number;
  }>;
};

export type RunbookFront = {
  id: string;
  scenarioId?: string | null;
  title: string;
  status: string;
  summary?: string | null;
  markdownPath?: string | null;
  pdfPath?: string | null;
  generatedAt?: string;
  updatedAt?: string;
};

export type RunbookTemplateFront = {
  id: string;
  originalName: string;
  format: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  signedUrl?: string | null;
};

export type IncidentServiceLink = {
  service: {
    id: string;
    name: string;
    criticality: string;
    type: string;
  };
};

export type IncidentDocumentLink = {
  document: {
    id: string;
    originalName: string;
    docType?: string | null;
  };
};

export type IncidentAction = {
  id: string;
  actionType: string;
  description?: string | null;
  createdAt: string;
  incident?: {
    id: string;
    title: string;
    status: string;
  };
};

export type Incident = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  detectedAt: string;
  responsibleTeam?: string | null;
  services: IncidentServiceLink[];
  documents: IncidentDocumentLink[];
  actions: IncidentAction[];
  createdAt: string;
  updatedAt: string;
};

export type NotificationChannel = {
  id: string;
  type: string;
  label?: string | null;
  isEnabled: boolean;
  n8nWebhookUrl: string;
  configuration?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type IncidentDashboard = {
  summary: {
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
  };
  recentIncidents: Incident[];
  recentActions: IncidentAction[];
};

export type TabId =
  | "services"
  | "continuity"
  | "bia"
  | "incidents"
  | "discovery"
  | "analysis"
  | "graph"
  | "architecture"
  | "landing"
  | "scenarios"
  | "documents"
  | "rag"
  | "runbooks"
  | "risks"
  | "auth"
  | "audit";

export type TabDefinition = {
  id: TabId;
  label: string;
  description: string;
};

export type ServiceDomain = {
  value: string;
  label: string;
  icon: string;
};
