import type { AccountContext } from '../identity/index.js';
import type { AccountScanError } from './types.js';

/**
 * Collecte et structure les erreurs de scan multi-account.
 */
export class ScanErrorCollector {
  private readonly errors: AccountScanError[] = [];

  public add(error: AccountScanError): void {
    this.errors.push(error);
  }

  public getErrors(): readonly AccountScanError[] {
    return [...this.errors];
  }

  public formatForCli(): string {
    if (!this.hasErrors()) {
      return 'All clear. No account scan errors.';
    }

    const lines = ['Scan Errors:'];
    for (const error of this.errors) {
      lines.push(
        `- ${formatAccount(error.account)} [${error.phase}] ${error.error.message}`,
      );
      lines.push(
        `  Impact: cross-account edges involving account ${error.account.accountId} may be incomplete.`,
      );
    }

    return lines.join('\n');
  }

  public hasErrors(): boolean {
    return this.errors.length > 0;
  }

  public allFailed(totalAccounts: number): boolean {
    return totalAccounts > 0 && this.errors.length === totalAccounts;
  }
}

function formatAccount(account: AccountContext): string {
  return account.accountAlias
    ? `${account.accountAlias} (${account.accountId})`
    : account.accountId;
}
