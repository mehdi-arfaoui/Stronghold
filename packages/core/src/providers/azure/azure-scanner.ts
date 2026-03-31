import type { DiscoveryCredentials } from '../../types/index.js';
import type {
  CloudProviderAdapter,
  ScanOptions,
  ScanOutput,
} from '../provider-interface.js';

/** Typed placeholder until Azure discovery is implemented in core. */
export class AzureScannerNotImplementedError extends Error {
  constructor() {
    super('Azure scanning not yet implemented');
    this.name = 'AzureScannerNotImplementedError';
  }
}

/** Compile-safe Azure provider adapter skeleton. */
export class AzureScanner implements CloudProviderAdapter {
  public readonly name = 'azure';

  public async scan(
    credentials: DiscoveryCredentials,
    options?: ScanOptions,
  ): Promise<ScanOutput> {
    void credentials;
    void options;

    throw new AzureScannerNotImplementedError();
  }
}

export const azureScanner = new AzureScanner();
