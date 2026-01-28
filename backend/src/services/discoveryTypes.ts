export type DiscoveryResourceKind = "service" | "infra";

export type OpenPort = {
  port: number;
  protocol: "tcp" | "udp";
  service?: string;
  version?: string;
  state?: string;
};

export type DiscoveredResource = {
  source: string;
  externalId: string;
  name: string;
  kind: DiscoveryResourceKind;
  type: string;
  ip?: string | null;
  hostname?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  openPorts?: OpenPort[] | null;
};

export type DiscoveredFlow = {
  sourceIp?: string | null;
  targetIp?: string | null;
  sourcePort?: number | null;
  targetPort?: number | null;
  protocol?: string | null;
  bytes?: number | null;
  packets?: number | null;
  observedAt?: Date | null;
};

export type DiscoveryConnectorResult = {
  resources: DiscoveredResource[];
  flows: DiscoveredFlow[];
  warnings: string[];
};

export type DiscoveryCredentialVaultRef = {
  vaultPath?: string;
  vaultKey?: string;
};

export type DiscoveryNetworkCredentials = {
  snmp?: { community?: string; version?: string; port?: number };
  ssh?: { username?: string; password?: string; privateKey?: string; port?: number };
  wmi?: { username?: string; password?: string };
};

export type DiscoveryCloudCredentials = {
  aws?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    region?: string;
    roleArn?: string;
    externalId?: string;
  };
  azure?: {
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    subscriptionId?: string;
  };
  gcp?: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  };
};

export type DiscoveryVirtualizationCredentials = {
  vmware?: { endpoint?: string; username?: string; password?: string };
  hyperv?: { endpoint?: string; username?: string; password?: string };
  kubernetes?: { kubeconfig?: string; context?: string };
};

export type DiscoveryFlowCredentials = {
  flowSamples?: Array<Record<string, unknown>>;
};

export type DiscoveryCredentials = DiscoveryCredentialVaultRef &
  DiscoveryNetworkCredentials &
  DiscoveryCloudCredentials &
  DiscoveryVirtualizationCredentials &
  DiscoveryFlowCredentials;

export type NetworkScanMode = "light" | "full";

export type NetworkScanOptions = {
  mode?: NetworkScanMode;
  topPorts?: number;
  timeout?: number;
};

export type DiscoveryRunContext = {
  tenantId: string;
  jobId: string;
  ipRanges: string[];
  cloudProviders: string[];
  credentials: DiscoveryCredentials;
  requestedBy: string | null;
  autoCreate: boolean;
  networkScanOptions?: NetworkScanOptions;
};

