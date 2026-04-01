export const STRONGHOLD_CONFIG_VERSION = 1;
export const DEFAULT_STRONGHOLD_CONFIG_PATH = '.stronghold/config.yml';

export interface StrongholdConfigDefaults {
  readonly regions?: readonly string[];
  readonly concurrency?: number;
  readonly scannerTimeout?: number;
}

export interface StrongholdAccountConfig {
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly regions?: readonly string[];
}

export interface StrongholdConfig {
  readonly version: number;
  readonly defaults?: StrongholdConfigDefaults;
  readonly accounts?: Readonly<Record<string, StrongholdAccountConfig>>;
}

export interface ResolvedStrongholdAccount {
  readonly name?: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly regions?: readonly string[];
  readonly concurrency?: number;
  readonly scannerTimeout?: number;
}
