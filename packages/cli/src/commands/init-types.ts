import type { CallerIdentity, DiscoveryCloudCredentials } from '@stronghold-dr/core';

export interface AwsProfileCatalog {
  readonly profiles: readonly string[];
  readonly defaultRegionByProfile: Readonly<Record<string, string>>;
}

export interface InitPrompter {
  ask(question: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  close(): void;
}

export interface InitCommandDependencies {
  readonly cwd?: () => string;
  readonly loadAwsProfileCatalog?: () => AwsProfileCatalog;
  readonly createPrompter?: () => InitPrompter;
  readonly getCallerIdentity?: (
    credentials: DiscoveryCloudCredentials,
  ) => Promise<CallerIdentity | null>;
  readonly verifyAwsCredentials?: (
    credentials: DiscoveryCloudCredentials,
    options: { readonly profile?: string },
  ) => Promise<void>;
  readonly output?: (message: string) => Promise<void>;
  readonly fileExists?: (filePath: string) => boolean;
  readonly writeConfigFile?: (contents: string, filePath: string) => Promise<string>;
}

export interface InitSelections {
  readonly profile: string;
  readonly allRegions: boolean;
  readonly regions?: readonly string[];
}
