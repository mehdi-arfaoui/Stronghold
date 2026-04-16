const ARN_PREFIX = 'arn';
const VALID_PARTITIONS = new Set(['aws', 'aws-cn', 'aws-us-gov']);

/**
 * Représentation structurée d'un ARN AWS, parsed from the canonical string.
 * See: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html
 */
export interface ParsedArn {
  readonly raw: string;
  readonly partition: string;
  readonly service: string;
  readonly region: string | null;
  readonly accountId: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string;
}

/**
 * Exception dédiée pour distinguer des autres erreurs.
 */
export class ArnParseError extends Error {
  public readonly input: string;

  constructor(input: string, reason: string) {
    super(`Invalid ARN "${input}": ${reason}`);
    this.name = 'ArnParseError';
    this.input = input;
  }
}

/**
 * Parse un ARN en structure. Lance une ArnParseError si le format est invalide.
 * Supporte les 3 formats canoniques :
 *   arn:partition:service:region:account-id:resource-id
 *   arn:partition:service:region:account-id:resource-type/resource-id
 *   arn:partition:service:region:account-id:resource-type:resource-id
 */
export function parseArn(arn: string): ParsedArn {
  const normalized = arn.trim();
  if (!normalized) {
    throw new ArnParseError(arn, 'ARN must not be empty');
  }

  const segments = normalized.split(':');
  if (segments.length < 6) {
    throw new ArnParseError(arn, 'ARN must contain at least 6 colon-delimited segments');
  }

  const prefix = segments[0];
  if (prefix !== ARN_PREFIX) {
    throw new ArnParseError(arn, 'ARN must start with "arn:"');
  }

  const partition = segments[1]?.trim() ?? '';
  if (!VALID_PARTITIONS.has(partition)) {
    throw new ArnParseError(arn, `Unsupported partition "${partition}"`);
  }

  const service = segments[2]?.trim() ?? '';
  if (!service) {
    throw new ArnParseError(arn, 'Service segment must not be empty');
  }

  const rawRegion = segments[3]?.trim() ?? '';
  const rawAccountId = segments[4]?.trim() ?? '';
  const resource = segments.slice(5).join(':').trim();

  if (!resource) {
    throw new ArnParseError(arn, 'Resource segment must not be empty');
  }

  if (rawAccountId && !/^\d{12}$/.test(rawAccountId)) {
    throw new ArnParseError(arn, `Invalid account ID "${rawAccountId}"`);
  }

  const [resourceType, resourceId] = splitResource(resource, arn);

  return {
    raw: normalized,
    partition,
    service,
    region: rawRegion ? rawRegion : null,
    accountId: rawAccountId ? rawAccountId : null,
    resourceType,
    resourceId,
  };
}

/**
 * Variante sans exception : retourne null si parsing échoue.
 */
export function tryParseArn(arn: string): ParsedArn | null {
  try {
    return parseArn(arn);
  } catch (error) {
    if (error instanceof ArnParseError) {
      return null;
    }
    throw error;
  }
}

/**
 * Reformate un ParsedArn en string canonique. Invariant : parseArn(formatArn(x)) deepEquals x.
 */
export function formatArn(parsed: ParsedArn): string {
  const region = parsed.region ?? '';
  const accountId = parsed.accountId ?? '';
  const resource = formatResource(parsed);
  return [
    ARN_PREFIX,
    parsed.partition,
    parsed.service,
    region,
    accountId,
    resource,
  ].join(':');
}

/**
 * Extrait uniquement l'account_id d'un ARN, pour les hot paths qui n'ont pas besoin du reste.
 * Plus rapide qu'un parseArn complet.
 */
export function extractAccountId(arn: string): string | null {
  if (!arn.startsWith('arn:')) {
    return null;
  }

  let segmentStart = 0;
  let segmentIndex = 0;

  for (let index = 0; index <= arn.length; index += 1) {
    const isBoundary = index === arn.length || arn[index] === ':';
    if (!isBoundary) {
      continue;
    }

    if (segmentIndex === 4) {
      const value = arn.slice(segmentStart, index).trim();
      return /^\d{12}$/.test(value) ? value : null;
    }

    segmentIndex += 1;
    segmentStart = index + 1;
  }

  return null;
}

function splitResource(resource: string, input: string): readonly [string | null, string] {
  const slashIndex = resource.indexOf('/');
  const colonIndex = resource.indexOf(':');

  if (slashIndex === -1 && colonIndex === -1) {
    return [null, resource];
  }

  const useSlash =
    slashIndex >= 0 && (colonIndex === -1 || slashIndex < colonIndex);
  const delimiterIndex = useSlash ? slashIndex : colonIndex;
  const resourceType = resource.slice(0, delimiterIndex).trim();
  const resourceId = resource.slice(delimiterIndex + 1).trim();

  if (!resourceType) {
    throw new ArnParseError(input, 'Resource type must not be empty');
  }
  if (!resourceId) {
    throw new ArnParseError(input, 'Resource identifier must not be empty');
  }

  return [resourceType, resourceId];
}

function formatResource(parsed: ParsedArn): string {
  if (!parsed.resourceType) {
    return parsed.resourceId;
  }

  const separator = inferSeparator(parsed);
  return `${parsed.resourceType}${separator}${parsed.resourceId}`;
}

function inferSeparator(parsed: ParsedArn): ':' | '/' {
  const parsedRaw = tryParseArn(parsed.raw);
  if (
    parsedRaw &&
    parsedRaw.partition === parsed.partition &&
    parsedRaw.service === parsed.service &&
    parsedRaw.region === parsed.region &&
    parsedRaw.accountId === parsed.accountId &&
    parsedRaw.resourceType === parsed.resourceType &&
    parsedRaw.resourceId === parsed.resourceId
  ) {
    const resource = parsed.raw.split(':').slice(5).join(':');
    const slashIndex = resource.indexOf('/');
    const colonIndex = resource.indexOf(':');
    if (slashIndex >= 0 && (colonIndex === -1 || slashIndex < colonIndex)) {
      return '/';
    }
    if (colonIndex >= 0) {
      return ':';
    }
  }

  if (parsed.resourceId.includes('/')) {
    return '/';
  }

  const slashStyleResourceTypes = new Set([
    'instance',
    'vpc',
    'subnet',
    'natgateway',
    'security-group',
    'file-system',
    'mount-target',
    'loadbalancer',
    'hostedzone',
    'recordset',
    'distribution',
    'role',
    'table',
  ]);

  return slashStyleResourceTypes.has(parsed.resourceType ?? '') ? '/' : ':';
}
