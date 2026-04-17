import type {
  AuthProvider,
  AuthTarget,
  AuthTargetHint,
  AwsCredentials,
} from '../auth/index.js';
import {
  buildAuthTarget,
  withAuthTargetRegion,
} from '../auth/index.js';
import type { AccountContext } from '../identity/index.js';

export interface ScanContext {
  readonly account: AccountContext;
  readonly region: string;
  readonly authProvider: AuthProvider;
  readonly target: AuthTarget;
  getCredentials(): Promise<AwsCredentials>;
}

export interface CreateScanContextOptions {
  readonly account: AccountContext;
  readonly region: string;
  readonly authProvider: AuthProvider;
  readonly authHint?: AuthTargetHint;
}

export function createScanContext(options: CreateScanContextOptions): ScanContext {
  const target = buildAuthTarget({
    account: options.account,
    region: options.region,
    ...(options.authHint ? { hint: options.authHint } : {}),
  });

  return {
    account: options.account,
    region: options.region,
    authProvider: options.authProvider,
    target,
    getCredentials: () => options.authProvider.getCredentials(target),
  };
}

export function withScanContextRegion(
  context: ScanContext,
  region: string,
): ScanContext {
  const target = withAuthTargetRegion(context.target, region);

  return {
    account: context.account,
    region,
    authProvider: context.authProvider,
    target,
    getCredentials: () => context.authProvider.getCredentials(target),
  };
}
