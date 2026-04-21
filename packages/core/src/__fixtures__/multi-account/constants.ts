import { createAccountContext, type AccountContext } from '../../identity/index.js';

/**
 * Shared constants for synthetic multi-account fixtures.
 * Account IDs are fictional but valid AWS-style 12 digit identifiers.
 */
export const PARTITION = 'aws' as const;

export const PROD_ACCOUNT_ID = '111111111111';
export const PROD_ACCOUNT_ALIAS = 'stronghold-test-prod';
export const PROD_REGION = 'eu-west-3';

export const STAGING_ACCOUNT_ID = '222222222222';
export const STAGING_ACCOUNT_ALIAS = 'stronghold-test-staging';
export const STAGING_REGION = 'eu-west-3';

export const GLOBAL_REGION = 'global';

export const PROD_ACCOUNT_CONTEXT = createAccountContext({
  accountId: PROD_ACCOUNT_ID,
  accountAlias: PROD_ACCOUNT_ALIAS,
  partition: PARTITION,
});

export const STAGING_ACCOUNT_CONTEXT = createAccountContext({
  accountId: STAGING_ACCOUNT_ID,
  accountAlias: STAGING_ACCOUNT_ALIAS,
  partition: PARTITION,
});

export function buildArn(params: {
  readonly service: string;
  readonly region?: string | null;
  readonly accountId?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId: string;
}): string {
  const region = params.region ?? '';
  const accountId = params.accountId ?? '';
  const resourcePrefix =
    params.resourceType && params.resourceType.length > 0
      ? `${params.resourceType}/`
      : '';

  return `arn:${PARTITION}:${params.service}:${region}:${accountId}:${resourcePrefix}${params.resourceId}`;
}

export function prodArn(
  service: string,
  resourceType: string | null,
  resourceId: string,
  region?: string | null,
): string {
  return buildArn({
    service,
    region: region ?? PROD_REGION,
    accountId: PROD_ACCOUNT_ID,
    resourceType,
    resourceId,
  });
}

export function stagingArn(
  service: string,
  resourceType: string | null,
  resourceId: string,
  region?: string | null,
): string {
  return buildArn({
    service,
    region: region ?? STAGING_REGION,
    accountId: STAGING_ACCOUNT_ID,
    resourceType,
    resourceId,
  });
}

export function route53Arn(resourceType: 'hostedzone' | 'recordset', resourceId: string): string {
  return buildArn({
    service: 'route53',
    region: null,
    accountId: null,
    resourceType,
    resourceId,
  });
}

export function iamRootArn(accountId: string): string {
  return buildArn({
    service: 'iam',
    region: null,
    accountId,
    resourceType: null,
    resourceId: 'root',
  });
}

export function createFixtureAccountContext(input: {
  readonly accountId: string;
  readonly accountAlias: string;
}): AccountContext {
  return createAccountContext({
    accountId: input.accountId,
    accountAlias: input.accountAlias,
    partition: PARTITION,
  });
}
