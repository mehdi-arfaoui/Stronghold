const VALID_PARTITIONS = new Set(['aws', 'aws-cn', 'aws-us-gov']);

/**
 * Contexte d'un account AWS dans un scan.
 * Porté par chaque Resource pour qu'on puisse requêter sans re-parser l'ARN à chaque fois.
 */
export interface AccountContext {
  readonly accountId: string;
  readonly accountAlias: string | null;
  readonly partition: string;
}

/**
 * Validateur strict : un account_id AWS est toujours 12 digits.
 */
export function isValidAccountId(value: string): boolean {
  return /^\d{12}$/.test(value);
}

/**
 * Construit un AccountContext, valide l'account_id.
 */
export function createAccountContext(input: {
  readonly accountId: string;
  readonly accountAlias?: string | null;
  readonly partition?: string;
}): AccountContext {
  if (!isValidAccountId(input.accountId)) {
    throw new Error(`Invalid AWS account ID: "${input.accountId}". Expected 12 digits.`);
  }

  const partition = (input.partition ?? 'aws').trim();
  if (!VALID_PARTITIONS.has(partition)) {
    throw new Error(`Invalid AWS partition: "${partition}".`);
  }

  return {
    accountId: input.accountId,
    accountAlias: input.accountAlias ?? null,
    partition,
  };
}
