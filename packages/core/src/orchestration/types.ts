import type {
  CredentialExpiredError,
  NoAuthProviderAvailableError,
} from '../auth/errors.js';
import type { AuthenticationError, AuthProvider } from '../auth/index.js';
import type { GraphInstance } from '../graph/graph-instance.js';
import type { AccountContext } from '../identity/index.js';
import type { Resource } from '../types/resource.js';
import type { WeightedValidationResult } from '../validation/validation-types.js';

export const DEFAULT_MULTI_ACCOUNT_CONCURRENCY = 3;
export const DEFAULT_ACCOUNT_SCAN_TIMEOUT_MS = 600_000;

export type Finding = WeightedValidationResult;

export type AccountScanPhase = 'authentication' | 'scanning' | 'processing';

/**
 * Configuration d'un account à scanner.
 * Correspond à une entrée résolue depuis la config YAML.
 */
export interface AccountScanTarget {
  readonly account: AccountContext;
  readonly regions: readonly string[];
  readonly authProvider: AuthProvider;
  readonly scanTimeoutMs?: number;
}

/**
 * Résultat du scan d'un account individuel avant merge global.
 */
export interface AccountScanResult {
  readonly account: AccountContext;
  readonly regions: readonly string[];
  readonly resources: readonly Resource[];
  readonly findings: readonly Finding[];
  readonly graph: GraphInstance;
  readonly scanDurationMs: number;
  readonly scannersExecuted: readonly string[];
  readonly scannersSkipped: readonly ScannerSkipReason[];
}

/**
 * Erreur sur un account spécifique pendant l'orchestration.
 */
export interface AccountScanError {
  readonly account: AccountContext;
  readonly phase: AccountScanPhase;
  readonly error: Error;
  readonly timestamp: Date;
}

/**
 * Résumé agrégé multi-account pour l'output.
 */
export interface MultiAccountSummary {
  readonly totalAccounts: number;
  readonly successfulAccounts: number;
  readonly failedAccounts: number;
  readonly totalResources: number;
  readonly resourcesByAccount: ReadonlyMap<string, number>;
  readonly totalFindings: number;
  readonly findingsByAccount: ReadonlyMap<string, number>;
  readonly crossAccountEdges: number;
}

/**
 * Résultat global après orchestration et merge.
 */
export interface MultiAccountScanResult {
  readonly accounts: readonly AccountScanResult[];
  readonly mergedGraph: GraphInstance;
  readonly mergedFindings: readonly Finding[];
  readonly errors: readonly AccountScanError[];
  readonly totalDurationMs: number;
  readonly summary: MultiAccountSummary;
}

export interface ScannerSkipReason {
  readonly scannerName: string;
  readonly reason: string;
}

export interface ScanEngine {
  scanAccount(target: AccountScanTarget): Promise<AccountScanResult>;
}

/**
 * Marque une erreur issue de la phase de scan d'un account.
 * L'orchestrateur s'en sert pour distinguer les échecs de scan
 * des erreurs de traitement postérieures.
 */
export class ScanExecutionError extends Error {
  public override readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ScanExecutionError';
    this.cause = cause;
  }
}

export type AuthenticationFailure =
  | AuthenticationError
  | NoAuthProviderAvailableError
  | CredentialExpiredError;
