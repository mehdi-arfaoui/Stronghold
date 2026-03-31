import { afterEach, describe, expect, it, vi } from 'vitest';

const getInput = vi.fn<(name: string, options?: { required?: boolean }) => string>();
const setSecret = vi.fn<(value: string) => void>();

vi.mock('@actions/core', () => ({
  getInput,
  setSecret,
}));

vi.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'mehdi-arfaoui', repo: 'stronghold' },
    sha: 'abc123',
    payload: {
      pull_request: {
        head: { ref: 'feature/dr-check' },
        base: { ref: 'main' },
      },
    },
  },
}));

describe('parseConfig', () => {
  afterEach(() => {
    getInput.mockReset();
    setSecret.mockReset();
    delete process.env.GITHUB_TOKEN;
  });

  it('parses the required inputs correctly', async () => {
    process.env.GITHUB_TOKEN = 'github-token';
    mockInputs({
      'aws-region': 'eu-west-1',
      'aws-access-key-id': 'access-key',
      'aws-secret-access-key': 'secret-key',
    });

    const { parseConfig } = await import('./config');
    const config = parseConfig();

    expect(config.awsAccessKeyId).toBe('access-key');
    expect(config.awsSecretAccessKey).toBe('secret-key');
    expect(config.githubToken).toBe('github-token');
    expect(setSecret).toHaveBeenCalledWith('access-key');
  });

  it('applies the default values', async () => {
    mockInputs({
      'aws-region': 'eu-west-1',
      'aws-access-key-id': 'access-key',
      'aws-secret-access-key': 'secret-key',
    });

    const { parseConfig } = await import('./config');
    const config = parseConfig();

    expect(config.services).toEqual([]);
    expect(config.failOnScoreDrop).toBe(0);
    expect(config.failUnderScore).toBe(0);
    expect(config.commentOnPR).toBe(true);
    expect(config.baselineBranch).toBe('main');
  });

  it('splits regions by comma', async () => {
    mockInputs({
      'aws-region': 'eu-west-1, us-east-1 , ap-southeast-2',
      'aws-access-key-id': 'access-key',
      'aws-secret-access-key': 'secret-key',
    });

    const { parseConfig } = await import('./config');
    const config = parseConfig();

    expect(config.regions).toEqual(['eu-west-1', 'us-east-1', 'ap-southeast-2']);
  });

  it('splits services by comma', async () => {
    mockInputs({
      'aws-region': 'eu-west-1',
      'aws-access-key-id': 'access-key',
      'aws-secret-access-key': 'secret-key',
      services: 'rds, s3 , lambda',
    });

    const { parseConfig } = await import('./config');
    const config = parseConfig();

    expect(config.services).toEqual(['rds', 's3', 'lambda']);
  });
});

function mockInputs(values: Record<string, string>): void {
  getInput.mockImplementation((name: string) => values[name] ?? '');
}
