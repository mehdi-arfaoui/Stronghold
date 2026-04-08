import { ConfigurationError } from '../errors/cli-error.js';
import type { Command } from 'commander';
import type { GraphOverrideCommandOptions } from './graph-overrides.js';

export const SUPPORTED_SERVICES = [
  'ec2',
  'rds',
  'aurora',
  's3',
  'lambda',
  'dynamodb',
  'elasticache',
  'sqs',
  'sns',
  'elb',
  'eks',
  'efs',
  'vpc',
  'route53',
  'backup',
  'cloudwatch',
] as const;

export type SupportedService = (typeof SUPPORTED_SERVICES)[number];

export const DEFAULT_PROVIDER = 'aws';
export const DEFAULT_SCAN_OUTPUT = 'summary';
export const DEFAULT_SCAN_CONCURRENCY = 5;
export const DEFAULT_SCANNER_TIMEOUT_SECONDS = 60;
export const DEFAULT_REPORT_FORMAT = 'terminal';
export const DEFAULT_PLAN_FORMAT = 'yaml';
export const DEFAULT_DEMO_SCENARIO = 'startup';
export const DEFAULT_DEMO_OUTPUT = 'summary';
export const DEFAULT_DRIFT_OUTPUT = 'terminal';

export type ScanOutputFormat = 'summary' | 'json' | 'silent';
export type ReportOutputFormat = 'terminal' | 'markdown' | 'json';
export type PlanOutputFormat = 'yaml' | 'json';
export type DemoScenario = 'startup' | 'enterprise' | 'minimal';
export type DriftOutputFormat = 'terminal' | 'json';

export interface ScanCommandOptions extends GraphOverrideCommandOptions {
  readonly provider: string;
  readonly region?: readonly string[];
  readonly allRegions: boolean;
  readonly account?: string;
  readonly profile?: string;
  readonly roleArn?: string;
  readonly externalId?: string;
  readonly services?: readonly SupportedService[];
  readonly concurrency?: number;
  readonly scannerTimeout?: number;
  readonly output: ScanOutputFormat;
  readonly save: boolean;
  readonly verbose: boolean;
}

export interface InitCommandOptions {
  readonly profile?: string;
  readonly region?: readonly string[];
  readonly yes: boolean;
}

export interface GlobalEncryptionOptions {
  readonly encrypt: boolean;
  readonly passphrase?: string;
  readonly redact?: boolean;
}

export interface ReportCommandOptions extends GraphOverrideCommandOptions {
  readonly format: ReportOutputFormat;
  readonly output?: string;
  readonly scan?: string;
  readonly category?: string;
  readonly severity?: string;
  readonly showPassed: boolean;
  readonly explainScore: boolean;
  readonly verbose: boolean;
}

export interface PlanGenerateCommandOptions extends GraphOverrideCommandOptions {
  readonly output?: string;
  readonly format: PlanOutputFormat;
  readonly scan?: string;
  readonly verbose: boolean;
}

export interface PlanValidateCommandOptions {
  readonly plan: string;
  readonly scan?: string;
  readonly verbose: boolean;
}

export interface PlanRunbookCommandOptions {
  readonly output?: string;
  readonly format: PlanOutputFormat;
  readonly scan?: string;
  readonly component?: string;
  readonly verbose: boolean;
}

export interface DriftCheckCommandOptions extends GraphOverrideCommandOptions {
  readonly baseline?: string;
  readonly current?: string;
  readonly saveBaseline: boolean;
  readonly format: DriftOutputFormat;
  readonly ci: boolean;
  readonly failThreshold?: number;
  readonly verbose: boolean;
}

export interface DemoCommandOptions {
  readonly scenario: DemoScenario;
  readonly output: Exclude<ScanOutputFormat, 'silent'>;
  readonly verbose: boolean;
}

export interface IamPolicyCommandOptions {
  readonly format: 'json' | 'terraform';
  readonly services?: readonly SupportedService[];
  readonly verbose: boolean;
}

export function parseCommaSeparatedList(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseRegionOption(value: string): readonly string[] {
  return parseCommaSeparatedList(value);
}

export function parseServiceOption(value: string): readonly SupportedService[] {
  const services = parseCommaSeparatedList(value).map((entry) => entry.toLowerCase());
  const invalid = services.filter((entry) => !isSupportedService(entry));
  if (invalid.length > 0) {
    throw new ConfigurationError(`Unsupported services: ${invalid.join(', ')}`);
  }

  return services as readonly SupportedService[];
}

export function parseConcurrencyOption(value: string): number {
  return parseBoundedInteger(value, 1, 16, '--concurrency');
}

export function parseScannerTimeoutOption(value: string): number {
  return parseBoundedInteger(value, 10, 300, '--scanner-timeout');
}

export function parseFailThresholdOption(value: string): number {
  return parseBoundedInteger(value, 0, 100, '--fail-threshold');
}

export function isSupportedService(value: string): value is SupportedService {
  return SUPPORTED_SERVICES.includes(value as SupportedService);
}

export function ensureVpcIncluded(
  services?: readonly SupportedService[],
): readonly SupportedService[] | undefined {
  if (!services || services.length === 0) {
    return services;
  }
  return services.includes('vpc') ? services : [...services, 'vpc'];
}

export function getCommandOptions<TOptions extends object>(
  command: Command,
): TOptions & GlobalEncryptionOptions {
  return command.optsWithGlobals() as TOptions & GlobalEncryptionOptions;
}

function parseBoundedInteger(
  value: string,
  min: number,
  max: number,
  optionName: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigurationError(`${optionName} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}
