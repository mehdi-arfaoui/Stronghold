import { ComputeManagementClient } from '@azure/arm-compute';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { ResourceManagementClient } from '@azure/arm-resources';
import { SqlManagementClient } from '@azure/arm-sql';
import { StorageManagementClient } from '@azure/arm-storage';
import { DefaultAzureCredential } from '@azure/identity';
import type { DiscoveryCredentials } from '../../types/index.js';

type AzureCredentials = DiscoveryCredentials['azure'];

/** Options used to build Azure SDK clients. */
export interface AzureClientFactoryOptions {
  readonly credentials?: AzureCredentials;
}

/** Typed set of Azure management clients used by discovery adapters. */
export interface AzureClientSet {
  readonly credential: DefaultAzureCredential;
  readonly resource: ResourceManagementClient;
  readonly compute: ComputeManagementClient;
  readonly containers: ContainerServiceClient;
  readonly storage: StorageManagementClient;
  readonly sql: SqlManagementClient;
}

class AzureClientFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AzureClientFactoryError';
  }
}

function requireSubscriptionId(credentials?: AzureCredentials): string {
  if (!credentials?.subscriptionId) {
    throw new AzureClientFactoryError(
      'Azure subscriptionId is required to create Azure SDK clients',
    );
  }

  return credentials.subscriptionId;
}

/**
 * Builds the default Azure credential chain used by local dev, CI,
 * service principals and managed identities.
 */
export function createAzureCredential(): DefaultAzureCredential {
  return new DefaultAzureCredential();
}

/** Creates the baseline Azure management clients for future scanners. */
export function createAzureClients(options: AzureClientFactoryOptions): AzureClientSet {
  const subscriptionId = requireSubscriptionId(options.credentials);
  const credential = createAzureCredential();

  return {
    credential,
    resource: new ResourceManagementClient(credential, subscriptionId),
    compute: new ComputeManagementClient(credential, subscriptionId),
    containers: new ContainerServiceClient(credential, subscriptionId),
    storage: new StorageManagementClient(credential, subscriptionId),
    sql: new SqlManagementClient(credential, subscriptionId),
  };
}
