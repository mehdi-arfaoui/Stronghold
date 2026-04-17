import { describe, expect, it } from 'vitest';

import {
  AssumeRoleAuthProvider,
  ProfileAuthProvider,
  SsoAuthProvider,
} from '../index.js';

describe.skip('auth providers (real AWS)', () => {
  it('supports manually validating a real profile provider', async () => {
    expect(ProfileAuthProvider).toBeDefined();
  });

  it('supports manually validating a real assume-role provider', async () => {
    expect(AssumeRoleAuthProvider).toBeDefined();
  });

  it('supports manually validating a real SSO provider', async () => {
    expect(SsoAuthProvider).toBeDefined();
  });
});
