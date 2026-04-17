import type { AuthProviderKind, AuthTarget } from './auth-provider.js';

export class AuthenticationError extends Error {
  public readonly target: AuthTarget;
  public readonly providerKind: AuthProviderKind;
  public override readonly cause?: unknown;

  public constructor(
    message: string,
    target: AuthTarget,
    providerKind: AuthProviderKind,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthenticationError';
    this.target = target;
    this.providerKind = providerKind;
    this.cause = cause;
  }
}

export class NoAuthProviderAvailableError extends Error {
  public readonly target: AuthTarget;
  public readonly attempted: readonly AuthProviderKind[];

  public constructor(
    target: AuthTarget,
    attempted: readonly AuthProviderKind[],
  ) {
    super(
      `No supported AWS authentication method was available for account ${target.accountId}. ` +
        `Attempted: ${attempted.join(', ') || 'none'}.`,
    );
    this.name = 'NoAuthProviderAvailableError';
    this.target = target;
    this.attempted = attempted;
  }
}

export class CredentialExpiredError extends Error {
  public readonly target: AuthTarget;

  public constructor(target: AuthTarget) {
    super(`Credentials for account ${target.accountId} have expired.`);
    this.name = 'CredentialExpiredError';
    this.target = target;
  }
}
