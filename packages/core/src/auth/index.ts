export {
  buildAuthTarget,
  getAuthTargetCacheKey,
  normalizeAwsCredentials,
  resolveStsRegion,
  withAuthTargetRegion,
  type AuthProvider,
  type AuthProviderKind,
  type AuthTarget,
  type AuthTargetHint,
  type AwsCredentials,
} from './auth-provider.js';

export { CredentialCache } from './credential-cache.js';

export {
  AuthenticationError,
  CredentialExpiredError,
  NoAuthProviderAvailableError,
} from './errors.js';

export { ProfileAuthProvider } from './profile-auth-provider.js';

export {
  AssumeRoleAuthProvider,
  DEFAULT_ASSUME_ROLE_NAME,
  extractRoleAccountId,
} from './assume-role-auth-provider.js';

export { SsoAuthProvider } from './sso-auth-provider.js';

export { DEFAULT_DETECTION_ORDER, detectAuthProvider } from './auth-detector.js';
