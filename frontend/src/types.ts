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

export type AppWarning = {
  type: string;
  service: string;
  dependsOn: string;
  message: string;
};

export type InfraFinding = {
  type: string;
  infra: string;
  infraType: string;
  location?: string | null;
  message: string;
};

export type GraphNode = {
  id: string;
  label: string;
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
  strength?: string;
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

export type DependencyRisk = {
  id: string;
  fromServiceId: string;
  toServiceId: string;
  fromServiceName: string;
  toServiceName: string;
  dependencyType: string | null;
  riskLevel: "low" | "medium" | "high";
  risks: string[];
  recommendations: string[];
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
    cost: string;
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
  dr: {
    recommendations: DrRecommendationFront[];
    comparison: Array<{
      id: string;
      label: string;
      rto: string;
      rpo: string;
      cost: string;
      complexity: string;
      description: string;
      notes: string;
    }>;
  };
  categories: Array<{ category: string; count: number; averageCriticality: string }>;
  rag: PraRagReport;
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

export type TabId =
  | "services"
  | "analysis"
  | "graph"
  | "architecture"
  | "landing"
  | "scenarios"
  | "documents"
  | "rag"
  | "runbooks";

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
