import { readFile } from 'node:fs/promises';

import Ajv, { type ErrorObject } from 'ajv';
import { parseDocument } from 'yaml';

import { CONTRACTS_SCHEMA } from './contract-schema.js';
import {
  type Contract,
  type ContractHookConfig,
  type ContractRequirement,
  type ContractsLoadResult,
  type ParsedDuration,
  type RawContract,
  type RawContractRequirement,
  type RawContractsConfig,
} from './contract-types.js';
import { parseDuration } from './duration-parser.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});

const validateContractsDocument = ajv.compile<RawContractsConfig>(CONTRACTS_SCHEMA);

/**
 * Loads and validates a contracts.yml file.
 */
export async function loadContracts(filePath: string): Promise<ContractsLoadResult> {
  try {
    const yamlContent = await readFile(filePath, 'utf8');
    return parseContractsYaml(yamlContent);
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      return { status: 'not_found' };
    }
    throw error;
  }
}

/**
 * Parses raw YAML content into typed in-memory contracts.
 */
export function parseContractsYaml(yamlContent: string): ContractsLoadResult {
  const parsed = parseYamlDocument(yamlContent);
  if (parsed.status === 'invalid') {
    return parsed;
  }

  if (!validateContractsDocument(parsed.value)) {
    return {
      status: 'invalid',
      errors: formatSchemaErrors(validateContractsDocument.errors ?? []),
    };
  }

  return buildContractsConfig(parsed.value);
}

function parseYamlDocument(
  yamlContent: string,
):
  | { readonly status: 'valid'; readonly value: unknown }
  | { readonly status: 'invalid'; readonly errors: readonly string[] } {
  try {
    const document = parseDocument(yamlContent);
    if (document.errors.length > 0) {
      return {
        status: 'invalid',
        errors: document.errors.map((error) => `YAML syntax error: ${error.message}`),
      };
    }

    return {
      status: 'valid',
      value: document.toJSON() as unknown,
    };
  } catch (error) {
    return {
      status: 'invalid',
      errors: [`YAML syntax error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function buildContractsConfig(rawConfig: RawContractsConfig): ContractsLoadResult {
  const errors: string[] = [];
  const contracts = rawConfig.contracts.map((contract) => mapContract(contract, errors));

  if (errors.length > 0) {
    return {
      status: 'invalid',
      errors,
    };
  }

  return {
    status: 'loaded',
    config: {
      version: rawConfig.version,
      contracts,
    },
  };
}

function mapContract(rawContract: RawContract, errors: string[]): Contract {
  return {
    service: rawContract.service,
    description: rawContract.description ?? null,
    owner: rawContract.owner ?? null,
    enforcement: rawContract.enforcement ?? 'warn',
    hook: rawContract.hook ? mapHook(rawContract.hook) : null,
    requirements: rawContract.requirements.map((requirement, index) =>
      mapRequirement(rawContract.service, requirement, index, errors),
    ),
  };
}

function mapHook(rawHook: NonNullable<RawContract['hook']>): ContractHookConfig {
  return {
    type: rawHook.type,
    url: rawHook.url,
    on: [...rawHook.on],
  };
}

function mapRequirement(
  service: string,
  rawRequirement: RawContractRequirement,
  index: number,
  errors: string[],
): ContractRequirement {
  return {
    scenario: rawRequirement.scenario,
    rto: parseOptionalDuration(service, index, 'rto', rawRequirement.rto, errors),
    rpo: parseOptionalDuration(service, index, 'rpo', rawRequirement.rpo, errors),
    evidence: rawRequirement.evidence ?? null,
    chainCoverage: rawRequirement.chain_coverage ?? null,
    spof: rawRequirement.spof ?? null,
  };
}

function parseOptionalDuration(
  service: string,
  requirementIndex: number,
  field: 'rto' | 'rpo',
  value: string | undefined,
  errors: string[],
): ParsedDuration | null {
  if (value === undefined) {
    return null;
  }

  try {
    return parseDuration(value);
  } catch (error) {
    errors.push(
      `Invalid duration "${value}" in contract for service "${service}" at requirements[${requirementIndex}].${field}: ${String(error)}`,
    );
    return null;
  }
}

function formatSchemaErrors(errors: readonly ErrorObject[]): readonly string[] {
  const issues = errors
    .filter((error) => error.keyword !== 'if')
    .map((error) => formatSchemaError(error));

  return Array.from(new Set(issues));
}

function formatSchemaError(error: ErrorObject): string {
  const basePath = toPathLabel(error.instancePath);

  if (error.keyword === 'additionalProperties') {
    const params = error.params as { readonly additionalProperty?: unknown };
    const additionalProperty = String(params.additionalProperty ?? 'unknown');
    const pathLabel = basePath ? `${basePath}.${additionalProperty}` : additionalProperty;
    return `${pathLabel} is not allowed.`;
  }

  if (error.keyword === 'required') {
    const params = error.params as { readonly missingProperty?: unknown };
    const missingProperty = String(params.missingProperty ?? 'unknown');
    const pathLabel = basePath ? `${basePath}.${missingProperty}` : missingProperty;
    return `${pathLabel} is required.`;
  }

  if (error.keyword === 'anyOf') {
    const pathLabel = basePath || 'contracts';
    return `${pathLabel} must include at least one verifiable dimension: rto, rpo, evidence, chain_coverage, or spof.`;
  }

  const pathLabel = basePath || 'contracts';
  return `${pathLabel} ${error.message ?? 'is invalid.'}`;
}

function toPathLabel(instancePath: string): string {
  if (!instancePath) {
    return '';
  }

  return instancePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^\d+$/u.test(segment) ? `[${segment}]` : segment))
    .reduce((result, segment) => {
      if (segment.startsWith('[')) {
        return `${result}${segment}`;
      }
      return result ? `${result}.${segment}` : segment;
    }, '');
}

function isErrorWithCode(error: unknown): error is { readonly code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { readonly code?: unknown }).code === 'string'
  );
}
