import {
  GetCallerIdentityCommand,
  STSClient,
} from '@aws-sdk/client-sts';

import type { DiscoveryCloudCredentials } from '../../types/discovery.js';
import { buildAwsClientConfig } from './aws-client-factory.js';

export interface CallerIdentity {
  readonly arn: string;
  readonly accountId: string;
  readonly userId: string;
}

const DEFAULT_STS_REGION = 'us-east-1';
const STS_TIMEOUT_MS = 3_000;

export async function getCallerIdentity(
  credentials: DiscoveryCloudCredentials = {},
): Promise<CallerIdentity | null> {
  const client = new STSClient(
    buildAwsClientConfig({
      region: credentials.region ?? DEFAULT_STS_REGION,
      credentials,
    }),
  );

  try {
    const response = await client.send(
      new GetCallerIdentityCommand({}),
      { abortSignal: AbortSignal.timeout(STS_TIMEOUT_MS) },
    );
    if (!response.Arn || !response.Account || !response.UserId) {
      return null;
    }

    return {
      arn: response.Arn,
      accountId: response.Account,
      userId: response.UserId,
    };
  } catch {
    return null;
  }
}
