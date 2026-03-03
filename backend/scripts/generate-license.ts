import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, importPKCS8 } from 'jose';
import {
  LICENSE_PLAN_DEFINITIONS,
  type LicenseFeature,
  type LicensePlan,
} from '../src/config/licensePlans.ts';

type CliArgs = {
  company?: string;
  plan?: LicensePlan;
  durationMonths: number;
  maxNodes?: number;
  maxUsers?: number;
  maxCloudEnvs?: number;
  output: string;
};

function parseNumberFlag(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flag}. Expected a number.`);
  }
  return Math.trunc(parsed);
}

function generateLicenseId(): string {
  return `lic_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    durationMonths: 12,
    output: 'stronghold.lic',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--company':
        parsed.company = next?.trim();
        index += 1;
        break;
      case '--plan': {
        const plan = next?.trim().toLowerCase();
        if (plan !== 'starter' && plan !== 'pro' && plan !== 'enterprise') {
          throw new Error('Invalid --plan. Use starter, pro, or enterprise.');
        }
        parsed.plan = plan;
        index += 1;
        break;
      }
      case '--duration':
        parsed.durationMonths = parseNumberFlag(next, '--duration');
        index += 1;
        break;
      case '--max-nodes':
        parsed.maxNodes = parseNumberFlag(next, '--max-nodes');
        index += 1;
        break;
      case '--max-users':
        parsed.maxUsers = parseNumberFlag(next, '--max-users');
        index += 1;
        break;
      case '--max-cloud-envs':
        parsed.maxCloudEnvs = parseNumberFlag(next, '--max-cloud-envs');
        index += 1;
        break;
      case '--output':
        parsed.output = next?.trim() || parsed.output;
        index += 1;
        break;
      case '--help':
      case '-h':
        printUsageAndExit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.company) {
    throw new Error('--company is required.');
  }
  if (!parsed.plan) {
    throw new Error('--plan is required.');
  }
  if (parsed.durationMonths <= 0) {
    throw new Error('--duration must be greater than 0.');
  }

  return parsed;
}

function printUsageAndExit(code: number): never {
  console.log([
    'Usage:',
    'npx ts-node scripts/generate-license.ts --company "Acme Corp" --plan pro --duration 12 --max-nodes 300 --max-users 50 --output stronghold.lic',
  ].join('\n'));
  process.exit(code);
}

function resolveExpiry(durationMonths: number): { iat: number; exp: number } {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

  return {
    iat: Math.floor(issuedAt.getTime() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
}

function resolveOutputPath(output: string): string {
  if (path.isAbsolute(output)) {
    return output;
  }
  return path.resolve(process.cwd(), output);
}

const currentFilePath = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFilePath), '..');
const privateKeyPath = path.join(backendRoot, 'license-private.pem');

try {
  const args = parseArgs(process.argv.slice(2));
  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  const planDefinition = LICENSE_PLAN_DEFINITIONS[args.plan];
  const { iat, exp } = resolveExpiry(args.durationMonths);

  const payload = {
    lid: generateLicenseId(),
    company: args.company,
    plan: args.plan,
    maxNodes: args.maxNodes ?? planDefinition.maxNodes,
    maxUsers: args.maxUsers ?? planDefinition.maxUsers,
    maxCloudEnvs: args.maxCloudEnvs ?? planDefinition.maxCloudEnvs,
    features: [...planDefinition.features] as LicenseFeature[],
    iat,
    exp,
  };

  const outputPath = resolveOutputPath(args.output);
  void (async () => {
    const signingKey = await importPKCS8(privateKey, 'EdDSA');
    const token = await new SignJWT({
      lid: payload.lid,
      company: payload.company,
      plan: payload.plan,
      maxNodes: payload.maxNodes,
      maxUsers: payload.maxUsers,
      maxCloudEnvs: payload.maxCloudEnvs,
      features: payload.features,
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(signingKey);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, token, 'utf-8');

    console.log('License generated successfully.');
    console.log(`Company: ${payload.company}`);
    console.log(`Plan: ${payload.plan}`);
    console.log(`License ID: ${payload.lid}`);
    console.log(`Max nodes: ${payload.maxNodes}`);
    console.log(`Max users: ${payload.maxUsers}`);
    console.log(`Max cloud envs: ${payload.maxCloudEnvs}`);
    console.log(`Features: ${payload.features.join(', ')}`);
    console.log(`Expires at: ${new Date(payload.exp * 1000).toISOString()}`);
    console.log(`Output: ${outputPath}`);
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unable to generate license.');
    printUsageAndExit(1);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to generate license.');
  printUsageAndExit(1);
}
