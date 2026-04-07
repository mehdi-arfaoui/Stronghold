import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { Command } from 'commander';
import {
  DEFAULT_STRONGHOLD_CONFIG_PATH,
  getCallerIdentity as resolveCallerIdentity,
} from '@stronghold-dr/core';

import {
  buildDiscoveryCredentials,
  verifyAwsCredentials,
} from '../config/credentials.js';
import type { InitCommandOptions } from '../config/options.js';
import {
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_SCANNER_TIMEOUT_SECONDS,
  parseRegionOption,
} from '../config/options.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { writeOutput } from '../output/io.js';
import { writeTextFile } from '../storage/secure-file-store.js';
import type {
  AwsProfileCatalog,
  InitCommandDependencies,
  InitPrompter,
  InitSelections,
} from './init-types.js';

const COMMON_REGION_OPTIONS = [
  { region: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
  { region: 'eu-west-3', label: 'eu-west-3 (Paris)' },
  { region: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
] as const;

const ALL_REGIONS_CHOICE = 4;
const CUSTOM_REGION_CHOICE = 5;

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Guide first-time setup from demo mode to a real AWS scan')
    .option('--profile <name>', 'AWS profile to save into .stronghold/config.yml')
    .option('--region <regions>', 'AWS region(s), comma-separated', parseRegionOption)
    .option('-y, --yes', 'Skip confirmation prompts', false)
    .action(async (_: InitCommandOptions, command: Command) => {
      const options = command.optsWithGlobals() as InitCommandOptions;
      await executeInitCommand(options);
    });
}

export async function executeInitCommand(
  options: InitCommandOptions,
  dependencies: InitCommandDependencies = {},
): Promise<string | null> {
  const cwd = dependencies.cwd?.() ?? process.cwd();
  const configPath = path.resolve(cwd, DEFAULT_STRONGHOLD_CONFIG_PATH);
  const catalog = dependencies.loadAwsProfileCatalog?.() ?? loadAwsProfileCatalog();
  const prompt = dependencies.createPrompter?.() ?? createReadlinePrompter();
  const outputLine = dependencies.output ?? defaultOutput;
  const fileExists = dependencies.fileExists ?? fs.existsSync;
  const writeConfigFile = dependencies.writeConfigFile ?? defaultWriteConfigFile;
  const getIdentity = dependencies.getCallerIdentity ?? resolveCallerIdentity;
  const verifyIdentity = dependencies.verifyAwsCredentials ?? verifyAwsCredentials;

  try {
    if (catalog.profiles.length === 0) {
      throw new ConfigurationError(
        'No AWS profiles found in ~/.aws/credentials or ~/.aws/config.\n' +
          'Configure one with: aws configure --profile stronghold',
      );
    }

    await outputLine('Stronghold Setup');
    await outputLine('');

    const profile = options.profile
      ? validateRequestedProfile(options.profile, catalog.profiles)
      : await promptForProfile(prompt, catalog, outputLine);
    const profileRegion = catalog.defaultRegionByProfile[profile];

    await outputLine(`Verifying credentials for profile "${profile}"...`);
    const credentials = buildDiscoveryCredentials({
      profile,
      region: profileRegion,
      includeEnvironmentCredentials: false,
    }).aws ?? {};
    const identity = await getIdentity(credentials);

    if (!identity) {
      await verifyIdentity(credentials, { profile });
      throw new ConfigurationError(
        `Unable to verify credentials for profile '${profile}'. Check your AWS profile and try again.`,
      );
    }

    await outputLine(`OK Authenticated as ${maskArnAccount(identity.arn)}`);
    await outputLine(`  Account: ${maskAccountId(identity.accountId)}`);
    await outputLine('');
    await outputLine('Stronghold will attempt to scan 16 AWS services during the scan.');
    await outputLine('Scanners without sufficient IAM permissions will be skipped automatically.');
    await outputLine('');
    await outputLine(
      'Note: Permission behavior may vary due to SCPs, resource policies, or VPC endpoint policies.',
    );
    await outputLine("Run 'stronghold iam-policy' to generate the minimal required IAM policy.");

    if (!options.yes) {
      const shouldContinue = await prompt.confirm('Continue? [Y/n]: ', true);
      if (!shouldContinue) {
        await outputLine('Setup cancelled.');
        return null;
      }
    }

    await outputLine('');

    const selections = options.region
      ? buildNonInteractiveSelections(profile, options.region)
      : await promptForRegions(prompt, profile, profileRegion, outputLine);

    if (fileExists(configPath) && !options.yes) {
      const overwrite = await prompt.confirm(
        `Configuration already exists at ${DEFAULT_STRONGHOLD_CONFIG_PATH}. Overwrite? [y/N]: `,
        false,
      );
      if (!overwrite) {
        await outputLine('Setup cancelled.');
        return null;
      }
    }

    const configContents = renderStrongholdConfig(selections);
    await outputLine(`Writing configuration to ${DEFAULT_STRONGHOLD_CONFIG_PATH}...`);
    await writeConfigFile(configContents, configPath);
    await outputLine('OK Configuration saved.');
    await outputLine('');
    await outputLine('Next steps:');
    await outputLine('  stronghold scan              Run your first real scan');
    await outputLine('  stronghold scan --encrypt    Scan with encrypted output');
    await outputLine('  stronghold iam-policy        Generate minimal IAM policy');
    await outputLine('  stronghold demo              Try with sample data first');

    return configPath;
  } finally {
    prompt.close();
  }
}

export function loadAwsProfileCatalog(homeDirectory = os.homedir()): AwsProfileCatalog {
  const awsDirectory = path.join(homeDirectory, '.aws');
  const profiles = new Set<string>();
  const defaultRegionByProfile: Record<string, string> = {};

  readAwsSections(path.join(awsDirectory, 'credentials'), 'credentials').forEach((section) => {
    profiles.add(section.name);
  });

  readAwsSections(path.join(awsDirectory, 'config'), 'config').forEach((section) => {
    profiles.add(section.name);
    const region = section.values.region;
    if (region) {
      defaultRegionByProfile[section.name] = region;
    }
  });

  return {
    profiles: sortProfiles(Array.from(profiles)),
    defaultRegionByProfile,
  };
}

export function renderStrongholdConfig(selections: InitSelections): string {
  const lines = ['version: 1', 'defaults:'];

  if (selections.allRegions) {
    lines.push('  all_regions: true');
  } else {
    lines.push('  regions:');
    selections.regions?.forEach((region) => {
      lines.push(`    - ${region}`);
    });
  }

  lines.push(`  concurrency: ${DEFAULT_SCAN_CONCURRENCY}`);
  lines.push(`  scanner_timeout: ${DEFAULT_SCANNER_TIMEOUT_SECONDS}`);
  lines.push('accounts:');
  lines.push('  default:');
  lines.push(`    profile: ${selections.profile}`);

  if (selections.allRegions) {
    lines.push('    all_regions: true');
  } else {
    lines.push('    regions:');
    selections.regions?.forEach((region) => {
      lines.push(`      - ${region}`);
    });
  }

  return lines.join('\n');
}

function buildNonInteractiveSelections(
  profile: string,
  regions: readonly string[],
): InitSelections {
  if (regions.length === 0) {
    throw new ConfigurationError('Provide at least one AWS region when using --region.');
  }

  return {
    profile,
    allRegions: false,
    regions,
  };
}

async function promptForProfile(
  prompt: InitPrompter,
  catalog: AwsProfileCatalog,
  outputLine: (message: string) => Promise<void>,
): Promise<string> {
  const defaultProfile = catalog.profiles.includes('default')
    ? 'default'
    : (catalog.profiles[0] ?? 'default');

  await outputLine('Which AWS profile should Stronghold use for scanning?');
  await outputLine('');
  await outputLine('Available profiles:');
  for (const [index, profile] of catalog.profiles.entries()) {
    await outputLine(`  ${index + 1}. ${profile}`);
  }
  await outputLine('');

  while (true) {
    const answer = (await prompt.ask(`Enter profile name or number [${defaultProfile}]: `)).trim();
    const normalized = answer.length === 0 ? defaultProfile : answer;
    const selected = resolveProfileSelection(normalized, catalog.profiles);
    if (selected) {
      await outputLine('');
      return selected;
    }

    await outputLine('Enter a valid AWS profile name or list number.');
  }
}

async function promptForRegions(
  prompt: InitPrompter,
  profile: string,
  profileRegion: string | undefined,
  outputLine: (message: string) => Promise<void>,
): Promise<InitSelections> {
  await outputLine('Which regions should Stronghold scan?');
  await outputLine('');
  for (const [index, option] of COMMON_REGION_OPTIONS.entries()) {
    await outputLine(`  ${index + 1}. ${option.label}`);
  }
  await outputLine(`  ${ALL_REGIONS_CHOICE}. All regions`);
  await outputLine(`  ${CUSTOM_REGION_CHOICE}. Enter custom list`);
  await outputLine('');

  const defaultChoice = resolveDefaultRegionChoice(profileRegion);

  while (true) {
    const answer = (await prompt.ask(`Your choice [${defaultChoice}]: `)).trim();
    const choice = answer.length === 0 ? defaultChoice : Number(answer);

    if (!Number.isInteger(choice) || choice < 1 || choice > CUSTOM_REGION_CHOICE) {
      await outputLine('Choose one of the listed region options.');
      continue;
    }

    if (choice >= 1 && choice <= COMMON_REGION_OPTIONS.length) {
      await outputLine('');
      return {
        profile,
        allRegions: false,
        regions: [COMMON_REGION_OPTIONS[choice - 1]?.region ?? COMMON_REGION_OPTIONS[0].region],
      };
    }

    if (choice === ALL_REGIONS_CHOICE) {
      await outputLine('');
      return {
        profile,
        allRegions: true,
      };
    }

    const defaultCustomList = profileRegion ?? COMMON_REGION_OPTIONS[0].region;
    while (true) {
      const customAnswer = (
        await prompt.ask(`Enter AWS regions (comma-separated) [${defaultCustomList}]: `)
      ).trim();
      const selectedRegions = parseRegionOption(
        customAnswer.length === 0 ? defaultCustomList : customAnswer,
      );
      if (selectedRegions.length > 0) {
        await outputLine('');
        return {
          profile,
          allRegions: false,
          regions: selectedRegions,
        };
      }

      await outputLine('Enter at least one AWS region.');
    }
  }
}

function resolveDefaultRegionChoice(profileRegion: string | undefined): number {
  if (!profileRegion) {
    return 1;
  }

  const matchingIndex = COMMON_REGION_OPTIONS.findIndex((option) => option.region === profileRegion);
  return matchingIndex >= 0 ? matchingIndex + 1 : CUSTOM_REGION_CHOICE;
}

function validateRequestedProfile(
  profile: string,
  availableProfiles: readonly string[],
): string {
  const trimmed = profile.trim();
  if (availableProfiles.includes(trimmed)) {
    return trimmed;
  }

  throw new ConfigurationError(
    `AWS profile '${trimmed}' was not found in ~/.aws/credentials or ~/.aws/config.`,
  );
}

function resolveProfileSelection(
  answer: string,
  availableProfiles: readonly string[],
): string | null {
  const asNumber = Number(answer);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= availableProfiles.length) {
    return availableProfiles[asNumber - 1] ?? null;
  }

  return availableProfiles.includes(answer) ? answer : null;
}

function readAwsSections(
  filePath: string,
  source: 'credentials' | 'config',
): ReadonlyArray<{ readonly name: string; readonly values: Readonly<Record<string, string>> }> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const sections: Array<{ name: string; values: Record<string, string> }> = [];
  let currentSection: { name: string; values: Record<string, string> } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch?.[1]) {
      const sectionName = normalizeAwsProfileSection(sectionMatch[1], source);
      currentSection = sectionName ? { name: sectionName, values: {} } : null;
      if (currentSection) {
        sections.push(currentSection);
      }
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().replace(/-/g, '_');
    const value = line.slice(separatorIndex + 1).trim();
    if (key.length > 0 && value.length > 0) {
      currentSection.values[key] = value;
    }
  }

  return sections;
}

function normalizeAwsProfileSection(
  sectionName: string,
  source: 'credentials' | 'config',
): string | null {
  if (source === 'credentials') {
    return sectionName.trim();
  }

  const trimmed = sectionName.trim();
  if (trimmed === 'default') {
    return 'default';
  }
  if (trimmed.startsWith('profile ')) {
    return trimmed.slice('profile '.length).trim();
  }
  return null;
}

function sortProfiles(profiles: readonly string[]): readonly string[] {
  return [...profiles].sort((left, right) => {
    if (left === 'default') {
      return -1;
    }
    if (right === 'default') {
      return 1;
    }
    return left.localeCompare(right);
  });
}

function createReadlinePrompter(): InitPrompter {
  const prompt = createInterface({ input, output });

  return {
    ask(question: string) {
      return prompt.question(question);
    },
    async confirm(question: string, defaultValue: boolean) {
      while (true) {
        const answer = (await prompt.question(question)).trim().toLowerCase();
        if (answer.length === 0) {
          return defaultValue;
        }
        if (answer === 'y' || answer === 'yes') {
          return true;
        }
        if (answer === 'n' || answer === 'no') {
          return false;
        }
      }
    },
    close() {
      prompt.close();
    },
  };
}

async function defaultOutput(message: string): Promise<void> {
  await writeOutput(message);
}

async function defaultWriteConfigFile(contents: string, filePath: string): Promise<string> {
  return writeTextFile(contents, filePath, { encrypt: false });
}

function maskAccountId(accountId: string): string {
  if (accountId.length <= 4) {
    return '*'.repeat(accountId.length);
  }

  return `****${accountId.slice(-4)}`;
}

function maskArnAccount(arn: string): string {
  return arn.replace(/:(\d{12}):/, (_, accountId: string) => `:${maskAccountId(accountId)}:`);
}
