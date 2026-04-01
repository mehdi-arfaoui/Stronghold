const PRIVATE_IP_PATTERN =
  /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g;
const PUBLIC_IP_PATTERN =
  /\b(?!(?:10|127)\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?:\d{1,3}\.){3}\d{1,3}\b/g;
const ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]*:[^:\s]*:[^:\s]+:[^\s"']+/gi;
const SECURITY_GROUP_PATTERN = /\bsg-[0-9a-f]{8,17}\b/gi;
const SUBNET_PATTERN = /\bsubnet-[0-9a-f]{8,17}\b/gi;
const VPC_PATTERN = /\bvpc-[0-9a-f]{8,17}\b/gi;
const INSTANCE_PATTERN = /\bi-[0-9a-f]{8,17}\b/gi;
const ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;
const SECRET_PATTERN = /([=:]\s*)([A-Za-z0-9/_+=-]{20,})(?=\b)/g;
const EXACT_PRIVATE_IP_PATTERN =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;
const EXACT_PUBLIC_IP_PATTERN =
  /^(?!(?:10|127)\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)(?:\d{1,3}\.){3}\d{1,3}$/;
const EXACT_ARN_PATTERN = /^arn:aws:[a-z0-9-]+:[a-z0-9-]*:[^:\s]*:[^:\s]+:[^\s"']+$/i;
const EXACT_SECURITY_GROUP_PATTERN = /^sg-[0-9a-f]{8,17}$/i;
const EXACT_SUBNET_PATTERN = /^subnet-[0-9a-f]{8,17}$/i;
const EXACT_VPC_PATTERN = /^vpc-[0-9a-f]{8,17}$/i;
const EXACT_INSTANCE_PATTERN = /^i-[0-9a-f]{8,17}$/i;
const EXACT_ACCESS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/;

export interface RedactionOptions {
  readonly level?: 'full' | 'partial' | 'none';
  readonly customPatterns?: readonly RegExp[];
  readonly preserve?: readonly string[];
}

export function redact(text: string, options: RedactionOptions = {}): string {
  const resolvedLevel = resolveLevel(options);
  if (resolvedLevel === 'none' || text.length === 0) {
    return text;
  }

  if (!options.preserve?.length && !options.customPatterns?.length) {
    const directRedaction = redactSingleValue(text, resolvedLevel);
    if (directRedaction) {
      return directRedaction;
    }
  }

  const preserved = preserveSegments(text, options.preserve);
  let redacted = preserved.value;
  const level = resolvedLevel;

  redacted = redacted.replace(ARN_PATTERN, (match) => redactArn(match, level));
  redacted = redacted.replace(PRIVATE_IP_PATTERN, (match) => redactPrivateIp(match, level));
  redacted = redacted.replace(PUBLIC_IP_PATTERN, () => '***.***.***.***');
  redacted = redacted.replace(SECURITY_GROUP_PATTERN, (match) =>
    redactIdentifier(match, 'sg-', level),
  );
  redacted = redacted.replace(SUBNET_PATTERN, (match) =>
    redactIdentifier(match, 'subnet-', level),
  );
  redacted = redacted.replace(VPC_PATTERN, (match) =>
    redactIdentifier(match, 'vpc-', level),
  );
  redacted = redacted.replace(INSTANCE_PATTERN, (match) =>
    redactIdentifier(match, 'i-', level),
  );
  redacted = redacted.replace(ACCESS_KEY_PATTERN, (match) =>
    match.includes('*') ? match : 'AKIA****',
  );
  redacted = redacted.replace(SECRET_PATTERN, (_, prefix: string) => `${prefix}****`);

  options.customPatterns?.forEach((pattern) => {
    redacted = redacted.replace(toGlobalPattern(pattern), '****');
  });

  return restorePreservedSegments(redacted, preserved.tokens);
}

function resolveLevel(options: RedactionOptions): 'full' | 'partial' | 'none' {
  return options.level ?? 'partial';
}

function redactArn(arn: string, level: 'full' | 'partial'): string {
  const segments = arn.split(':');
  if (segments.length < 6) {
    return arn;
  }

  const prefix = segments[0];
  const partition = segments[1];
  const service = segments[2];
  const region = segments[3];
  const accountId = segments[4];
  if (!prefix || !partition || !service || region === undefined || !accountId) {
    return arn;
  }

  const maskedAccount =
    accountId.includes('*')
      ? level === 'full'
        ? '****'
        : accountId
      : level === 'full'
        ? '****'
        : redactAccountId(accountId);
  const resourceParts = segments.slice(5);
  const resource = resourceParts.join(':');
  const maskedResource = level === 'full' ? '****' : redactArnResource(resource);

  return [prefix, partition, service, region, maskedAccount, maskedResource].join(':');
}

function redactAccountId(accountId: string): string {
  return /^\d{12}$/.test(accountId) ? `****${accountId.slice(-4)}` : accountId;
}

function redactArnResource(resource: string): string {
  if (resource.includes('****')) {
    return resource;
  }

  const delimiterMatch = resource.match(/[:/]/);
  if (!delimiterMatch || delimiterMatch.index === undefined) {
    return `${resource.slice(0, Math.min(8, resource.length))}****`;
  }

  const delimiterIndex = delimiterMatch.index;
  const prefix = resource.slice(0, delimiterIndex + 1);
  const identifier = resource.slice(delimiterIndex + 1);
  return `${prefix}${identifier.slice(0, Math.min(8, identifier.length))}****`;
}

function redactPrivateIp(ipAddress: string, level: 'full' | 'partial'): string {
  if (level === 'full') {
    return '***.***.***.***';
  }

  const firstOctet = ipAddress.split('.')[0] ?? '***';
  return `${firstOctet}.***.***.**`;
}

function redactIdentifier(
  value: string,
  prefix: string,
  level: 'full' | 'partial',
): string {
  if (value.includes('*')) {
    return value;
  }

  if (level === 'full') {
    return `${prefix}****`;
  }

  return `${prefix}****${value.slice(-4)}`;
}

function preserveSegments(
  text: string,
  preserve: readonly string[] | undefined,
): {
  readonly value: string;
  readonly tokens: ReadonlyMap<string, string>;
} {
  if (!preserve || preserve.length === 0) {
    return {
      value: text,
      tokens: new Map<string, string>(),
    };
  }

  let value = text;
  const tokens = new Map<string, string>();
  preserve
    .filter((entry) => entry.length > 0)
    .sort((left, right) => right.length - left.length)
    .forEach((entry, index) => {
      const token = `__STRONGHOLD_PRESERVE_${index}__`;
      if (!value.includes(entry)) {
        return;
      }
      tokens.set(token, entry);
      value = value.split(entry).join(token);
    });

  return { value, tokens };
}

function restorePreservedSegments(value: string, tokens: ReadonlyMap<string, string>): string {
  let restored = value;
  tokens.forEach((original, token) => {
    restored = restored.split(token).join(original);
  });
  return restored;
}

function toGlobalPattern(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

function redactSingleValue(
  text: string,
  level: 'full' | 'partial',
): string | null {
  if (EXACT_ARN_PATTERN.test(text)) {
    return redactArn(text, level);
  }
  if (EXACT_PRIVATE_IP_PATTERN.test(text)) {
    return redactPrivateIp(text, level);
  }
  if (EXACT_PUBLIC_IP_PATTERN.test(text)) {
    return '***.***.***.***';
  }
  if (EXACT_SECURITY_GROUP_PATTERN.test(text)) {
    return redactIdentifier(text, 'sg-', level);
  }
  if (EXACT_SUBNET_PATTERN.test(text)) {
    return redactIdentifier(text, 'subnet-', level);
  }
  if (EXACT_VPC_PATTERN.test(text)) {
    return redactIdentifier(text, 'vpc-', level);
  }
  if (EXACT_INSTANCE_PATTERN.test(text)) {
    return redactIdentifier(text, 'i-', level);
  }
  if (EXACT_ACCESS_KEY_PATTERN.test(text)) {
    return 'AKIA****';
  }
  return null;
}
