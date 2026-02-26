export type NodeType =
  | 'VM'
  | 'CONTAINER'
  | 'SERVERLESS'
  | 'KUBERNETES_CLUSTER'
  | 'DATABASE'
  | 'CACHE'
  | 'LOAD_BALANCER'
  | 'API_GATEWAY'
  | 'VPC'
  | 'SUBNET'
  | 'OBJECT_STORAGE'
  | 'MESSAGE_QUEUE'
  | 'CDN'
  | 'DNS'
  | 'FIREWALL'
  | 'THIRD_PARTY_API'
  | 'SAAS_SERVICE'
  | 'PHYSICAL_SERVER'
  | 'REGION'
  | 'AVAILABILITY_ZONE'
  | 'APPLICATION'
  | 'MICROSERVICE';

export type EdgeType =
  | 'CONNECTS_TO'
  | 'DEPENDS_ON'
  | 'RUNS_ON'
  | 'CONTAINS'
  | 'ROUTES_TO'
  | 'REPLICATES_TO'
  | 'BACKS_UP_TO'
  | 'network_access'
  | 'triggers'
  | 'uses'
  | 'dead_letter'
  | 'publishes_to'
  | 'placed_in'
  | 'secured_by'
  | 'iam_access';

export interface InfraNode {
  id: string;
  name: string;
  type: NodeType;
  provider?: string;
  region?: string;
  availabilityZone?: string;
  metadata?: Record<string, unknown>;
  criticality?: number;
  redundancy?: number;
  isSPOF?: boolean;
  blastRadius?: number;
  multiAZ?: boolean;
  replicas?: number;
}

export interface InfraEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  inferred?: boolean;
  confidence?: number;
  confirmed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GraphData {
  nodes: InfraNode[];
  edges: InfraEdge[];
  stats?: GraphStats;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  spofCount: number;
  inferredEdges: number;
  providers: string[];
  regions: string[];
}

export type NodeStatus = 'down' | 'degraded' | 'healthy';
