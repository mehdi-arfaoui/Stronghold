/** Types for infrastructure discovery, scanned resources, and network flows. */

export type DiscoveryResourceKind = 'service' | 'infra';

export interface OpenPort {
  readonly port: number;
  readonly protocol: 'tcp' | 'udp';
  readonly service?: string;
  readonly version?: string;
  readonly state?: string;
}

export interface DiscoveredResource {
  readonly source: string;
  readonly externalId: string;
  name: string;
  readonly kind: DiscoveryResourceKind;
  readonly type: string;
  readonly ip?: string | null;
  readonly hostname?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  readonly openPorts?: OpenPort[] | null;
}

export interface DiscoveredFlow {
  readonly sourceIp?: string | null;
  readonly targetIp?: string | null;
  readonly sourcePort?: number | null;
  readonly targetPort?: number | null;
  readonly protocol?: string | null;
  readonly bytes?: number | null;
  readonly packets?: number | null;
  readonly observedAt?: Date | null;
}

export interface DiscoveryConnectorResult {
  readonly resources: DiscoveredResource[];
  readonly flows: DiscoveredFlow[];
  readonly warnings: string[];
}

export interface DiscoveryCloudCredentials {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
  readonly region?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
}

export interface DiscoveryCredentials {
  readonly aws?: DiscoveryCloudCredentials;
  readonly azure?: {
    readonly tenantId?: string;
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly subscriptionId?: string;
  };
  readonly gcp?: {
    readonly projectId?: string;
    readonly clientEmail?: string;
    readonly privateKey?: string;
  };
}
