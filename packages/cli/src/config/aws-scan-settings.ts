import {
  DEFAULT_STRONGHOLD_CONFIG_PATH,
  extractRoleAccountId,
  loadStrongholdConfig,
  parseArn,
  type AuthTargetHint,
  type StrongholdAccountConfig,
  type StrongholdAwsAccountConfig,
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
  readonly accountId?: string;
  readonly partition: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly authHint?: AuthTargetHint;
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
  const selectedAccount = resolveSelectedAccount(options.account, config);
  const profile = firstDefined(
    options.profile,
    resolveAwsAccountProfile(selectedAccount.awsAccount),
    selectedAccount.legacyAccount?.profile,
    config?.aws?.profile,
  );
  const roleArn = firstDefined(
    options.roleArn,
    resolveAwsAccountRoleArn(selectedAccount.awsAccount),
    selectedAccount.legacyAccount?.roleArn,
  );
  const externalId = firstDefined(
    options.externalId,
    resolveAwsAccountExternalId(selectedAccount.awsAccount),
    selectedAccount.legacyAccount?.externalId,
  );
  const authHint = resolveAuthHint({
    explicitProfile: options.profile,
    explicitRoleArn: options.roleArn,
    explicitExternalId: options.externalId,
    selectedAccount,
    config,
  });
  const configAllRegions =
    selectedAccount.awsAccount?.allRegions === true ||
    selectedAccount.legacyAccount?.allRegions === true ||
    config?.defaults?.allRegions === true;
  const allRegions = options.allRegions || (options.region ? false : configAllRegions);
  const explicitRegions = allRegions
    ? undefined
    : firstNonEmptyArray(
        options.region,
        resolveAwsAccountRegions(selectedAccount.awsAccount),
        selectedAccount.legacyAccount?.regions,
        config?.aws?.region ? [config.aws.region] : undefined,
        config?.defaults?.regions,
      );
  const partition = resolvePartition(selectedAccount.awsAccount, roleArn);
  const accountId = firstDefined(
    selectedAccount.awsAccount?.accountId,
    authHint?.kind === 'sso' ? authHint.accountId : undefined,
    roleArn ? extractRoleAccountId(roleArn) ?? undefined : undefined,
  );

  return {
    allRegions,
    ...(explicitRegions ? { explicitRegions } : {}),
    ...(selectedAccount.name ? { accountName: selectedAccount.name } : {}),
    ...(accountId ? { accountId } : {}),
    partition,
    ...(profile ? { profile } : {}),
    ...(roleArn ? { roleArn } : {}),
    ...(externalId ? { externalId } : {}),
    ...(authHint ? { authHint } : {}),
    concurrency:
      firstDefined(options.concurrency, config?.defaults?.concurrency) ??
      DEFAULT_SCAN_CONCURRENCY,
    scannerTimeout:
      firstDefined(options.scannerTimeout, config?.defaults?.scannerTimeout) ??
      DEFAULT_SCANNER_TIMEOUT_SECONDS,
  };
}

function resolveSelectedAccount(
  explicitAccountName: string | undefined,
  config: StrongholdConfig | null,
): {
  readonly name?: string;
  readonly awsAccount?: StrongholdAwsAccountConfig;
  readonly legacyAccount?: StrongholdAccountConfig;
} {
  const selectedAwsAccount = resolveSelectedAwsAccount(explicitAccountName, config);
  if (selectedAwsAccount) {
    return selectedAwsAccount;
  }

  const selectedLegacyAccountName = resolveSelectedLegacyAccountName(explicitAccountName, config);
  if (selectedLegacyAccountName) {
    return {
      name: selectedLegacyAccountName,
      legacyAccount: resolveLegacyAccountConfig(selectedLegacyAccountName, config),
    };
  }

  return {};
}

function resolveSelectedLegacyAccountName(
  explicitAccountName: string | undefined,
  config: StrongholdConfig | null,
): string | undefined {
  if (explicitAccountName) {
    if (config?.accounts?.[explicitAccountName]) {
      return explicitAccountName;
    }

    if (config?.aws?.accounts?.some((account) => isMatchingAwsAccount(account, explicitAccountName))) {
      return undefined;
    }

    if (!config) {
      throw new ConfigurationError(
        `No Stronghold config found at ${DEFAULT_STRONGHOLD_CONFIG_PATH}. ` +
          `Create ${DEFAULT_STRONGHOLD_CONFIG_PATH} before using --account ${explicitAccountName}.`,
      );
    }

    throw new ConfigurationError(
      `Account '${explicitAccountName}' was not found in ${DEFAULT_STRONGHOLD_CONFIG_PATH}.`,
    );
  }

  return config?.accounts?.default ? 'default' : undefined;
}

function resolveLegacyAccountConfig(
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

function resolveSelectedAwsAccount(
  explicitAccountName: string | undefined,
  config: StrongholdConfig | null,
): {
  readonly name: string;
  readonly awsAccount: StrongholdAwsAccountConfig;
} | undefined {
  const awsAccounts = config?.aws?.accounts ?? [];
  if (awsAccounts.length === 0) {
    return undefined;
  }

  if (explicitAccountName) {
    const selected = awsAccounts.find((account) => isMatchingAwsAccount(account, explicitAccountName));
    return selected
      ? {
          name: selected.alias ?? selected.accountId,
          awsAccount: selected,
        }
      : undefined;
  }

  if (awsAccounts.length === 1) {
    const [selected] = awsAccounts;
    return selected
      ? {
          name: selected.alias ?? selected.accountId,
          awsAccount: selected,
        }
      : undefined;
  }

  throw new ConfigurationError(
    `Multiple AWS accounts are configured in ${DEFAULT_STRONGHOLD_CONFIG_PATH}. ` +
      `Use --account <alias|accountId> until multi-account orchestration is enabled.`,
  );
}

function isMatchingAwsAccount(account: StrongholdAwsAccountConfig, selection: string): boolean {
  return account.accountId === selection || account.alias === selection;
}

function resolveAwsAccountProfile(
  account: StrongholdAwsAccountConfig | undefined,
): string | undefined {
  return account?.auth?.kind === 'profile' ? account.auth.profileName : undefined;
}

function resolveAwsAccountRoleArn(
  account: StrongholdAwsAccountConfig | undefined,
): string | undefined {
  return account?.auth?.kind === 'assume-role' ? account.auth.roleArn : undefined;
}

function resolveAwsAccountExternalId(
  account: StrongholdAwsAccountConfig | undefined,
): string | undefined {
  return account?.auth?.kind === 'assume-role' ? account.auth.externalId : undefined;
}

function resolveAwsAccountRegions(
  account: StrongholdAwsAccountConfig | undefined,
): readonly string[] | undefined {
  return firstNonEmptyArray(
    account?.regions,
    account?.region ? [account.region] : undefined,
  );
}

function resolvePartition(
  account: StrongholdAwsAccountConfig | undefined,
  roleArn: string | undefined,
): string {
  if (account?.partition) {
    return account.partition;
  }

  if (roleArn) {
    try {
      return parseArn(roleArn).partition;
    } catch {
      return 'aws';
    }
  }

  return 'aws';
}

function resolveAuthHint(input: {
  readonly explicitProfile?: string;
  readonly explicitRoleArn?: string;
  readonly explicitExternalId?: string;
  readonly selectedAccount: {
    readonly awsAccount?: StrongholdAwsAccountConfig;
    readonly legacyAccount?: StrongholdAccountConfig;
  };
  readonly config: StrongholdConfig | null;
}): AuthTargetHint | undefined {
  if (input.explicitRoleArn) {
    return {
      kind: 'assume-role',
      roleArn: input.explicitRoleArn,
      ...(input.explicitExternalId ? { externalId: input.explicitExternalId } : {}),
    };
  }

  if (input.explicitProfile) {
    return {
      kind: 'profile',
      profileName: input.explicitProfile,
    };
  }

  const awsAccount = input.selectedAccount.awsAccount;
  if (awsAccount?.auth) {
    if (awsAccount.auth.kind === 'sso') {
      if (awsAccount.auth.accountId && awsAccount.auth.accountId !== awsAccount.accountId) {
        throw new ConfigurationError(
          `SSO auth config for account ${awsAccount.accountId} must not override accountId.`,
        );
      }

      return {
        kind: 'sso',
        ssoProfileName: awsAccount.auth.ssoProfileName,
        accountId: awsAccount.accountId,
        roleName: awsAccount.auth.roleName,
      };
    }

    return awsAccount.auth;
  }

  const legacyAccount = input.selectedAccount.legacyAccount;
  if (legacyAccount?.roleArn) {
    return {
      kind: 'assume-role',
      roleArn: legacyAccount.roleArn,
      ...(legacyAccount.externalId ? { externalId: legacyAccount.externalId } : {}),
    };
  }

  if (legacyAccount?.profile) {
    return {
      kind: 'profile',
      profileName: legacyAccount.profile,
    };
  }

  if (input.config?.aws?.profile) {
    return {
      kind: 'profile',
      profileName: input.config.aws.profile,
    };
  }

  return undefined;
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
