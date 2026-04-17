export const STRONGHOLD_CONFIG_VERSION = 1;
export const DEFAULT_STRONGHOLD_CONFIG_PATH = '.stronghold/config.yml';

export interface StrongholdConfigDefaults {
  readonly regions?: readonly string[];
  readonly allRegions?: boolean;
  readonly concurrency?: number;
  readonly accountConcurrency?: number;
  readonly scannerTimeout?: number;
  readonly scanTimeoutMs?: number;
}

export interface StrongholdAccountConfig {
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly regions?: readonly string[];
  readonly allRegions?: boolean;
  readonly scanTimeoutMs?: number;
}

export interface StrongholdAwsProfileAuthConfig {
  readonly kind: 'profile';
  readonly profileName: string;
}

export interface StrongholdAwsAssumeRoleAuthConfig {
  readonly kind: 'assume-role';
  readonly roleArn?: string;
  readonly sessionName?: string;
  readonly externalId?: string;
}

export interface StrongholdAwsSsoAuthConfig {
  readonly kind: 'sso';
  readonly ssoProfileName: string;
  readonly roleName: string;
  readonly accountId?: string;
}

export type StrongholdAwsAuthConfig =
  | StrongholdAwsProfileAuthConfig
  | StrongholdAwsAssumeRoleAuthConfig
  | StrongholdAwsSsoAuthConfig;

export interface StrongholdAwsAccountConfig {
  readonly accountId: string;
  readonly alias?: string;
  readonly partition?: string;
  readonly region?: string;
  readonly regions?: readonly string[];
  readonly allRegions?: boolean;
  readonly scanTimeoutMs?: number;
  readonly auth?: StrongholdAwsAuthConfig;
}

export interface StrongholdAwsConfig {
  readonly profile?: string;
  readonly region?: string;
  readonly accounts?: readonly StrongholdAwsAccountConfig[];
}

export interface StrongholdConfig {
  readonly version: number;
  readonly defaults?: StrongholdConfigDefaults;
  readonly accounts?: Readonly<Record<string, StrongholdAccountConfig>>;
  readonly aws?: StrongholdAwsConfig;
}

export interface ResolvedStrongholdAccount {
  readonly name?: string;
  readonly accountId?: string;
  readonly alias?: string;
  readonly partition?: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly region?: string;
  readonly regions?: readonly string[];
  readonly allRegions?: boolean;
  readonly concurrency?: number;
  readonly accountConcurrency?: number;
  readonly scannerTimeout?: number;
  readonly scanTimeoutMs?: number;
}
