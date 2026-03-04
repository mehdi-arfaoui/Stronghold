type ServiceIdentityInput = {
  name?: string | null;
  businessName?: string | null;
  type?: string | null;
  metadata?: unknown;
};

export type ServiceIdentity = {
  displayName: string;
  technicalName: string;
  businessName: string | null;
  source: 'manual_override' | 'metadata_override' | 'generated' | 'metadata_display' | 'technical_name';
};

const PREFIX_PATTERNS = [
  /^stronghold[-_]+terraform[-_]+/i,
  /^terraform[-_]+/i,
  /^(prod|production|prd)[-_]+/i,
  /^(staging|stage|stg)[-_]+/i,
  /^(dev|development|demo|test|qa|uat|preprod|sandbox)[-_]+/i,
];

const REGION_SUFFIX_PATTERN =
  /[-_](af|ap|ca|eu|me|sa|us)-(central|east|north|south|west|northeast|northwest|southeast|southwest)-\d[a-z]?$/i;

const LEADING_NOISE_TOKENS = new Set([
  'stronghold',
  'terraform',
  'prod',
  'production',
  'prd',
  'staging',
  'stage',
  'stg',
  'dev',
  'development',
  'demo',
  'test',
  'qa',
  'uat',
  'preprod',
  'sandbox',
]);

const TOKEN_TRANSLATIONS: Record<string, string> = {
  order: 'commandes',
  orders: 'commandes',
  alert: 'alertes',
  alerts: 'alertes',
  session: 'sessions utilisateurs',
  sessions: 'sessions utilisateurs',
  user: 'utilisateurs',
  users: 'utilisateurs',
  payment: 'paiements',
  payments: 'paiements',
  billing: 'facturation',
  auth: 'authentification',
  backup: 'sauvegardes',
  backups: 'sauvegardes',
  main: 'principal',
  primary: 'principal',
};

type PatternRule = {
  label: string;
  matchers: RegExp[];
  removeTokens: string[];
  preferredTypes?: string[];
  fallbackQualifier?: string;
};

const PATTERN_RULES: PatternRule[] = [
  {
    label: 'File DLQ',
    matchers: [/(^|[-_])(dlq|dead[-_]?letter)([-_]|$)/i],
    removeTokens: ['dlq', 'dead', 'letter', 'deadletter'],
  },
  {
    label: 'Base de donnees',
    matchers: [/(^|[-_])(db|database|rds|postgres|postgresql|mysql|mariadb|aurora)([-_]|$)/i],
    removeTokens: ['db', 'database', 'rds', 'postgres', 'postgresql', 'mysql', 'mariadb', 'aurora'],
    preferredTypes: ['DATABASE'],
    fallbackQualifier: 'principale',
  },
  {
    label: 'Cache',
    matchers: [/(^|[-_])(redis|cache|elasticache|memcached)([-_]|$)/i],
    removeTokens: ['redis', 'cache', 'elasticache', 'memcached'],
    preferredTypes: ['CACHE'],
    fallbackQualifier: 'principal',
  },
  {
    label: 'Serveur API',
    matchers: [/(^|[-_])(api|api[-_]?server|backend)([-_]|$)/i],
    removeTokens: ['api', 'server', 'backend', 'apiserver'],
    preferredTypes: ['VM', 'APPLICATION', 'MICROSERVICE', 'CONTAINER', 'KUBERNETES_SERVICE'],
    fallbackQualifier: 'principal',
  },
  {
    label: 'Worker',
    matchers: [/(^|[-_])(worker|processor|consumer|job)([-_]|$)/i],
    removeTokens: ['worker', 'processor', 'consumer', 'job'],
    fallbackQualifier: 'principal',
  },
  {
    label: 'File de messages',
    matchers: [/(^|[-_])(queue|sqs)([-_]|$)/i],
    removeTokens: ['queue', 'sqs'],
    preferredTypes: ['MESSAGE_QUEUE'],
  },
  {
    label: 'Topic de notifications',
    matchers: [/(^|[-_])(topic|sns|notification|notifications)([-_]|$)/i],
    removeTokens: ['topic', 'sns', 'notification', 'notifications'],
    preferredTypes: ['MESSAGE_QUEUE'],
  },
  {
    label: 'Stockage',
    matchers: [/(^|[-_])(bucket|s3|assets|asset|backups|backup|storage|files?)([-_]|$)/i],
    removeTokens: ['bucket', 's3', 'assets', 'asset', 'backups', 'backup', 'storage', 'file', 'files'],
    preferredTypes: ['OBJECT_STORAGE', 'FILE_STORAGE'],
  },
  {
    label: 'Fonction',
    matchers: [/(^|[-_])(lambda|function|serverless)([-_]|$)/i],
    removeTokens: ['lambda', 'function', 'serverless'],
    preferredTypes: ['SERVERLESS'],
  },
  {
    label: 'Reseau VPC',
    matchers: [/(^|[-_])(vpc|vnet)([-_]|$)/i],
    removeTokens: ['vpc', 'vnet'],
    preferredTypes: ['VPC'],
  },
  {
    label: 'Sous-reseau',
    matchers: [/(^|[-_])subnet([-_]|$)/i],
    removeTokens: ['subnet'],
    preferredTypes: ['SUBNET'],
  },
  {
    label: 'Groupe de securite',
    matchers: [/(^|[-_])(sg|security[-_]?group)([-_]|$)/i],
    removeTokens: ['sg', 'security', 'group', 'securitygroup'],
    preferredTypes: ['FIREWALL'],
  },
];

const TYPE_FALLBACK_RULES: Record<string, PatternRule> = {
  DATABASE: {
    label: 'Base de donnees',
    matchers: [],
    removeTokens: [],
    fallbackQualifier: 'principale',
  },
  CACHE: {
    label: 'Cache',
    matchers: [],
    removeTokens: [],
    fallbackQualifier: 'principal',
  },
  VM: {
    label: 'Service applicatif',
    matchers: [],
    removeTokens: [],
  },
  APPLICATION: {
    label: 'Service applicatif',
    matchers: [],
    removeTokens: [],
  },
  MICROSERVICE: {
    label: 'Microservice',
    matchers: [],
    removeTokens: [],
  },
  SERVERLESS: {
    label: 'Fonction',
    matchers: [],
    removeTokens: [],
  },
  MESSAGE_QUEUE: {
    label: 'File de messages',
    matchers: [],
    removeTokens: [],
  },
  OBJECT_STORAGE: {
    label: 'Stockage',
    matchers: [],
    removeTokens: [],
  },
  FILE_STORAGE: {
    label: 'Stockage',
    matchers: [],
    removeTokens: [],
  },
  VPC: {
    label: 'Reseau VPC',
    matchers: [],
    removeTokens: [],
  },
  SUBNET: {
    label: 'Sous-reseau',
    matchers: [],
    removeTokens: [],
  },
  FIREWALL: {
    label: 'Groupe de securite',
    matchers: [],
    removeTokens: [],
  },
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stripNamingNoise(name: string): string {
  let normalized = name.trim();
  for (const pattern of PREFIX_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  normalized = normalized.replace(REGION_SUFFIX_PATTERN, '');
  return normalized.replace(/^[-_]+|[-_]+$/g, '');
}

function tokenizeTechnicalName(name: string): string[] {
  const normalized = stripNamingNoise(name);
  const tokens = normalized
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  while (tokens.length > 0 && LEADING_NOISE_TOKENS.has(tokens[0]!.toLowerCase())) {
    tokens.shift();
  }
  while (tokens.length > 0 && LEADING_NOISE_TOKENS.has(tokens[tokens.length - 1]!.toLowerCase())) {
    tokens.pop();
  }

  return tokens;
}

function translateQualifierToken(token: string): string {
  const normalized = token.toLowerCase();
  return TOKEN_TRANSLATIONS[normalized] ?? normalized;
}

function humanizeQualifier(tokens: string[]): string | null {
  const qualifier = tokens
    .map((token) => translateQualifierToken(token))
    .filter(Boolean)
    .join(' ')
    .trim();
  return qualifier.length > 0 ? qualifier.toLowerCase() : null;
}

function selectPatternRule(name: string, nodeType: string): PatternRule | null {
  const normalizedType = nodeType.toUpperCase();
  for (const rule of PATTERN_RULES) {
    const matchesPattern = rule.matchers.some((matcher) => matcher.test(name));
    const typeMatches =
      !rule.preferredTypes || rule.preferredTypes.length === 0 || rule.preferredTypes.includes(normalizedType);
    if (matchesPattern && typeMatches) {
      return rule;
    }
  }
  return TYPE_FALLBACK_RULES[normalizedType] ?? null;
}

function buildGeneratedBusinessName(input: {
  technicalName: string;
  nodeType: string;
}): string | null {
  const rule = selectPatternRule(input.technicalName, input.nodeType);
  if (!rule) return null;

  const qualifierTokens = tokenizeTechnicalName(input.technicalName).filter(
    (token) => !rule.removeTokens.includes(token.toLowerCase()),
  );
  const qualifier = humanizeQualifier(qualifierTokens) ?? rule.fallbackQualifier ?? null;

  if (!qualifier) return rule.label;
  if (qualifier.toLowerCase() === rule.label.toLowerCase()) return rule.label;
  return `${rule.label} ${qualifier}`;
}

export function resolveServiceIdentity(input: ServiceIdentityInput): ServiceIdentity {
  const metadata = toMetadataRecord(input.metadata);
  const technicalName = readString(input.name) ?? 'Service';
  const manualBusinessName = readString(input.businessName);
  if (manualBusinessName) {
    return {
      displayName: manualBusinessName,
      technicalName,
      businessName: manualBusinessName,
      source: 'manual_override',
    };
  }

  const metadataBusinessName =
    readString(metadata.businessName) ??
    readString(metadata.friendlyName) ??
    readString(metadata.alias);
  if (metadataBusinessName) {
    return {
      displayName: metadataBusinessName,
      technicalName,
      businessName: metadataBusinessName,
      source: 'metadata_override',
    };
  }

  const generated = buildGeneratedBusinessName({
    technicalName,
    nodeType: String(input.type || metadata.sourceType || 'APPLICATION'),
  });
  if (generated) {
    return {
      displayName: generated,
      technicalName,
      businessName: null,
      source: 'generated',
    };
  }

  const metadataDisplayName = readString(metadata.displayName);
  if (metadataDisplayName && metadataDisplayName !== technicalName) {
    return {
      displayName: metadataDisplayName,
      technicalName,
      businessName: null,
      source: 'metadata_display',
    };
  }

  return {
    displayName: technicalName,
    technicalName,
    businessName: null,
    source: 'technical_name',
  };
}
