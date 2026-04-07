import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type { CallerIdentity } from '@stronghold-dr/core';
import { parseStrongholdConfig } from '@stronghold-dr/core';

import { executeInitCommand } from '../commands/init.js';
import type { InitPrompter } from '../commands/init-types.js';
import { ConfigurationError } from '../errors/cli-error.js';
import { createTempDirectory } from './test-utils.js';

function createPromptStub(
  answers: {
    readonly ask?: readonly string[];
    readonly confirm?: readonly boolean[];
    readonly failOnUse?: boolean;
  } = {},
): InitPrompter {
  const askAnswers = [...(answers.ask ?? [])];
  const confirmAnswers = [...(answers.confirm ?? [])];

  return {
    async ask() {
      if (answers.failOnUse) {
        throw new Error('Prompt should not be used.');
      }
      return askAnswers.shift() ?? '';
    },
    async confirm() {
      if (answers.failOnUse) {
        throw new Error('Prompt should not be used.');
      }
      return confirmAnswers.shift() ?? false;
    },
    close() {
      return undefined;
    },
  };
}

function createIdentity(): CallerIdentity {
  return {
    arn: 'arn:aws:iam::123456789012:user/stronghold-scanner',
    accountId: '123456789012',
    userId: 'AIDAEXAMPLE',
  };
}

describe('init command', () => {
  it('non-interactive mode creates config file correctly', async () => {
    const directory = createTempDirectory('stronghold-init-');
    const outputs: string[] = [];

    await executeInitCommand(
      {
        profile: 'production',
        region: ['eu-west-1', 'eu-west-3'],
        yes: true,
      },
      {
        cwd: () => directory,
        createPrompter: () => createPromptStub({ failOnUse: true }),
        loadAwsProfileCatalog: () => ({
          profiles: ['default', 'production'],
          defaultRegionByProfile: {
            production: 'eu-west-1',
          },
        }),
        getCallerIdentity: async () => createIdentity(),
        output: async (message) => {
          outputs.push(message);
        },
      },
    );

    const configPath = path.join(directory, '.stronghold', 'config.yml');
    expect(fs.existsSync(configPath)).toBe(true);
    expect(outputs.join('\n')).toContain('Writing configuration to .stronghold/config.yml...');

    const contents = fs.readFileSync(configPath, 'utf8').trimEnd();
    expect(contents).toBe(
      [
        'version: 1',
        'defaults:',
        '  regions:',
        '    - eu-west-1',
        '    - eu-west-3',
        '  concurrency: 5',
        '  scanner_timeout: 60',
        'accounts:',
        '  default:',
        '    profile: production',
        '    regions:',
        '      - eu-west-1',
        '      - eu-west-3',
      ].join('\n'),
    );
    expect(parseStrongholdConfig(contents)).toEqual({
      version: 1,
      defaults: {
        regions: ['eu-west-1', 'eu-west-3'],
        concurrency: 5,
        scannerTimeout: 60,
      },
      accounts: {
        default: {
          profile: 'production',
          regions: ['eu-west-1', 'eu-west-3'],
        },
      },
    });
  });

  it('yes skips confirmation prompts', async () => {
    const directory = createTempDirectory('stronghold-init-');
    const configPath = path.join(directory, '.stronghold', 'config.yml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'version: 1\n', 'utf8');

    await executeInitCommand(
      {
        profile: 'production',
        region: ['eu-west-1'],
        yes: true,
      },
      {
        cwd: () => directory,
        createPrompter: () => createPromptStub({ failOnUse: true }),
        loadAwsProfileCatalog: () => ({
          profiles: ['production'],
          defaultRegionByProfile: {},
        }),
        getCallerIdentity: async () => createIdentity(),
      },
    );

    const contents = fs.readFileSync(configPath, 'utf8');
    expect(contents).toContain('profile: production');
  });

  it('existing config file is not overwritten without confirmation', async () => {
    const directory = createTempDirectory('stronghold-init-');
    const configPath = path.join(directory, '.stronghold', 'config.yml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'version: 1\naccounts:\n  default:\n    profile: keep-me\n', 'utf8');

    const result = await executeInitCommand(
      {
        profile: 'production',
        region: ['eu-west-1'],
        yes: false,
      },
      {
        cwd: () => directory,
        createPrompter: () => createPromptStub({ confirm: [true, false] }),
        loadAwsProfileCatalog: () => ({
          profiles: ['production'],
          defaultRegionByProfile: {},
        }),
        getCallerIdentity: async () => createIdentity(),
      },
    );

    expect(result).toBeNull();
    expect(fs.readFileSync(configPath, 'utf8')).toContain('profile: keep-me');
  });

  it('validates the requested profile name against available profiles', async () => {
    await expect(
      executeInitCommand(
        {
          profile: 'missing',
          region: ['eu-west-1'],
          yes: true,
        },
        {
          createPrompter: () => createPromptStub({ failOnUse: true }),
          loadAwsProfileCatalog: () => ({
            profiles: ['default', 'production'],
            defaultRegionByProfile: {},
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: ConfigurationError.name,
      exitCode: 2,
    });
  });

  it('surfaces identity verification failures with exit code 2', async () => {
    await expect(
      executeInitCommand(
        {
          profile: 'production',
          region: ['eu-west-1'],
          yes: true,
        },
        {
          createPrompter: () => createPromptStub({ failOnUse: true }),
          loadAwsProfileCatalog: () => ({
            profiles: ['production'],
            defaultRegionByProfile: {},
          }),
          getCallerIdentity: async () => null,
          verifyAwsCredentials: async () => {
            throw new ConfigurationError("AWS profile 'production' could not be loaded.");
          },
        },
      ),
    ).rejects.toMatchObject({
      name: ConfigurationError.name,
      exitCode: 2,
      message: "AWS profile 'production' could not be loaded.",
    });
  });

  it('fails clearly when no AWS profiles are found', async () => {
    await expect(
      executeInitCommand(
        {
          yes: true,
        },
        {
          createPrompter: () => createPromptStub({ failOnUse: true }),
          loadAwsProfileCatalog: () => ({
            profiles: [],
            defaultRegionByProfile: {},
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: ConfigurationError.name,
      exitCode: 2,
    });
  });
});
