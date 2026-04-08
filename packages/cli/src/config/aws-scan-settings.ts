import {
  DEFAULT_STRONGHOLD_CONFIG_PATH,
  loadStrongholdConfig,
  type StrongholdAccountConfig,
  type StrongholdConfig,
} from '@stronghold-dr/core';

import { ConfigurationError } from '../errors/cli-error.js';
import {
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_SCANNER_TIMEOUT_SECONDS,
  type ScanCommandOptions,
} from './options.js';

export interface ResolveAwsScanSettingsOptions {
  readonly config?: StrongholdConfig | null;
  readonly configPath?: string;
}

export interface ResolvedAwsScanSettings {
  readonly allRegions: boolean;
  readonly explicitRegions?: readonly string[];
  readonly accountName?: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly concurrency: number;
  readonly scannerTimeout: number;
}

export function resolveAwsScanSettings(
  options: ScanCommandOptions,
  resolutionOptions: ResolveAwsScanSettingsOptions = {},
): ResolvedAwsScanSettings {
  const config = Object.prototype.hasOwnProperty.call(resolutionOptions, 'config')
    ? (resolutionOptions.config ?? null)
    : loadStrongholdConfig(resolutionOptions.configPath);
  const selectedAccountName = resolveSelectedAccountName(options.account, config);
  const accountConfig = resolveAccountConfig(selectedAccountName, config);
  const profile = firstDefined(options.profile, accountConfig?.profile);
  const roleArn = firstDefined(options.roleArn, accountConfig?.roleArn);
  const externalId = firstDefined(options.externalId, accountConfig?.externalId);
  const configAllRegions =
    accountConfig?.allRegions === true || config?.defaults?.allRegions === true;
  const allRegions = options.allRegions || (options.region ? false : configAllRegions);
  const explicitRegions = allRegions
    ? undefined
    : firstNonEmptyArray(options.region, accountConfig?.regions, config?.defaults?.regions);

  return {
    allRegions,
    ...(explicitRegions ? { explicitRegions } : {}),
    ...(selectedAccountName ? { accountName: selectedAccountName } : {}),
    ...(profile ? { profile } : {}),
    ...(roleArn ? { roleArn } : {}),
    ...(externalId ? { externalId } : {}),
    concurrency:
      firstDefined(options.concurrency, config?.defaults?.concurrency) ??
      DEFAULT_SCAN_CONCURRENCY,
    scannerTimeout:
      firstDefined(options.scannerTimeout, config?.defaults?.scannerTimeout) ??
      DEFAULT_SCANNER_TIMEOUT_SECONDS,
  };
}

function resolveSelectedAccountName(
  explicitAccountName: string | undefined,
  config: StrongholdConfig | null,
): string | undefined {
  if (explicitAccountName) {
    return explicitAccountName;
  }

  return config?.accounts?.default ? 'default' : undefined;
}

function resolveAccountConfig(
  accountName: string | undefined,
  config: StrongholdConfig | null,
): StrongholdAccountConfig | undefined {
  if (!accountName) {
    return undefined;
  }

  if (!config) {
    throw new ConfigurationError(
      `No Stronghold config found at ${DEFAULT_STRONGHOLD_CONFIG_PATH}. ` +
        `Create ${DEFAULT_STRONGHOLD_CONFIG_PATH} before using --account ${accountName}.`,
    );
  }

  const account = config.accounts?.[accountName];
  if (!account) {
    throw new ConfigurationError(
      `Account '${accountName}' was not found in ${DEFAULT_STRONGHOLD_CONFIG_PATH}.`,
    );
  }

  return account;
}

function firstDefined<TValue>(
  ...values: readonly (TValue | undefined | null)[]
): TValue | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function firstNonEmptyArray<TValue>(
  ...values: readonly (readonly TValue[] | undefined | null)[]
): readonly TValue[] | undefined {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return undefined;
}
