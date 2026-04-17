import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { fromSSO } from '@aws-sdk/credential-providers';

import {
  getAuthTargetCacheKey,
  normalizeAwsCredentials,
  type AuthProvider,
  type AuthTarget,
  type AwsCredentials,
} from './auth-provider.js';
import { CredentialCache } from './credential-cache.js';
import { AuthenticationError, CredentialExpiredError } from './errors.js';

interface SsoProfileDefinition {
  readonly profileName: string;
  readonly accountId: string;
  readonly roleName: string;
  readonly startUrl?: string;
  readonly ssoRegion?: string;
  readonly sessionName?: string;
}

export class SsoAuthProvider implements AuthProvider {
  public readonly kind = 'sso' as const;
  private readonly cache: CredentialCache;
  private readonly resolvedProfiles = new Map<string, SsoProfileDefinition>();

  public constructor(options: {
    readonly cache?: CredentialCache;
    readonly fromSsoFactory?: typeof fromSSO;
  } = {}) {
    this.cache = options.cache ?? new CredentialCache();
    this.fromSsoFactory = options.fromSsoFactory ?? fromSSO;
  }

  private readonly fromSsoFactory: typeof fromSSO;

  public async getCredentials(target: AuthTarget): Promise<AwsCredentials> {
    const profile = await this.resolveProfile(target);
    const cacheKey = `sso:${profile.profileName}:${getAuthTargetCacheKey(target)}`;

    return this.cache.get(cacheKey, async () => {
      try {
        const provider = this.fromSsoFactory({
          profile: profile.profileName,
        });
        const credentials = await provider();
        if (credentials.expiration && credentials.expiration.getTime() <= Date.now()) {
          throw new CredentialExpiredError(target);
        }

        return normalizeAwsCredentials(credentials);
      } catch (error) {
        if (error instanceof CredentialExpiredError) {
          throw error;
        }

        throw new AuthenticationError(
          `SSO credentials are unavailable for profile ${profile.profileName}. ` +
            `Run aws sso login --profile ${profile.profileName}.`,
          target,
          this.kind,
          error,
        );
      }
    });
  }

  public async canHandle(target: AuthTarget): Promise<boolean> {
    if (target.hint && target.hint.kind !== 'sso') {
      return false;
    }

    try {
      const profile = await this.resolveProfile(target);
      return this.hasValidSsoCache(profile);
    } catch {
      return false;
    }
  }

  public describeAuthMethod(target: AuthTarget): string {
    const resolved = this.resolvedProfiles.get(getAuthTargetCacheKey(target));
    const hintedProfile = target.hint && target.hint.kind === 'sso'
      ? target.hint.ssoProfileName
      : undefined;
    return `sso:${resolved?.profileName ?? hintedProfile ?? 'auto'}`;
  }

  private async resolveProfile(target: AuthTarget): Promise<SsoProfileDefinition> {
    const profiles = await loadSsoProfiles();
    const cacheKey = getAuthTargetCacheKey(target);
    const cached = this.resolvedProfiles.get(cacheKey);
    if (cached) {
      return cached;
    }

    let resolved: SsoProfileDefinition | undefined;
    if (target.hint?.kind === 'sso') {
      const hint = target.hint;
      resolved = profiles.find((profile) => profile.profileName === hint.ssoProfileName);
      if (!resolved) {
        throw new AuthenticationError(
          `SSO profile ${hint.ssoProfileName} was not found in the AWS config file.`,
          target,
          this.kind,
        );
      }

      if (resolved.accountId !== target.accountId || resolved.roleName !== hint.roleName) {
        throw new AuthenticationError(
          `SSO profile ${resolved.profileName} does not match account ${target.accountId} and role ${hint.roleName}.`,
          target,
          this.kind,
        );
      }
    } else {
      const matchingProfiles = profiles.filter((profile) => profile.accountId === target.accountId);
      for (const profile of matchingProfiles) {
        if (await this.hasValidSsoCache(profile)) {
          resolved = profile;
          break;
        }
      }
      resolved = resolved ?? matchingProfiles[0];
    }

    if (!resolved) {
      throw new AuthenticationError(
        `No SSO profile was configured for account ${target.accountId}.`,
        target,
        this.kind,
      );
    }

    this.resolvedProfiles.set(cacheKey, resolved);
    return resolved;
  }

  private async hasValidSsoCache(profile: SsoProfileDefinition): Promise<boolean> {
    if (!profile.startUrl) {
      return false;
    }

    const cacheDirectory = path.join(resolveAwsHomeDirectory(), '.aws', 'sso', 'cache');
    try {
      const entries = await fs.readdir(cacheDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }

        const cachePath = path.join(cacheDirectory, entry.name);
        const parsed = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Record<string, unknown>;
        const startUrl = typeof parsed.startUrl === 'string' ? parsed.startUrl : undefined;
        const expiresAt = typeof parsed.expiresAt === 'string' ? parsed.expiresAt : undefined;
        if (!startUrl || startUrl !== profile.startUrl || !expiresAt) {
          continue;
        }

        const expiration = new Date(expiresAt);
        if (!Number.isNaN(expiration.getTime()) && expiration.getTime() > Date.now()) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}

async function loadSsoProfiles(): Promise<readonly SsoProfileDefinition[]> {
  const configPath = resolveAwsConfigPath();

  let contents: string;
  try {
    contents = await fs.readFile(configPath, 'utf8');
  } catch {
    return [];
  }

  const sections = parseIniSections(contents);
  const profiles: SsoProfileDefinition[] = [];

  for (const [sectionName, values] of sections.entries()) {
    if (!sectionName.startsWith('profile ')) {
      continue;
    }

    const accountId = normalizeOptionalString(values.sso_account_id);
    const roleName = normalizeOptionalString(values.sso_role_name);
    if (!accountId || !roleName) {
      continue;
    }

    const sessionName = normalizeOptionalString(values.sso_session);
    const sessionSection = sessionName ? sections.get(`sso-session ${sessionName}`) : undefined;
    const startUrl =
      normalizeOptionalString(values.sso_start_url) ??
      normalizeOptionalString(sessionSection?.sso_start_url);
    const ssoRegion =
      normalizeOptionalString(values.sso_region) ??
      normalizeOptionalString(sessionSection?.sso_region);

    profiles.push({
      profileName: sectionName.slice('profile '.length).trim(),
      accountId,
      roleName,
      ...(startUrl ? { startUrl } : {}),
      ...(ssoRegion ? { ssoRegion } : {}),
      ...(sessionName ? { sessionName } : {}),
    });
  }

  return profiles;
}

function parseIniSections(contents: string): Map<string, Record<string, string>> {
  const sections = new Map<string, Record<string, string>>();
  let currentSection: string | null = null;

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      sections.set(currentSection, {});
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    const currentValues = sections.get(currentSection) ?? {};
    currentValues[key] = value;
    sections.set(currentSection, currentValues);
  }

  return sections;
}

function resolveAwsHomeDirectory(): string {
  return os.homedir();
}

function resolveAwsConfigPath(): string {
  const overridden = normalizeOptionalString(process.env.AWS_CONFIG_FILE);
  if (overridden) {
    return overridden;
  }

  return path.join(resolveAwsHomeDirectory(), '.aws', 'config');
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
