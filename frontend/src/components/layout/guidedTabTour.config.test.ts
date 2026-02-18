import { describe, expect, it } from 'vitest';
import {
  buildGuidedTabStorageKey,
  GUIDED_TAB_GUIDES,
  resolveGuidedTab,
} from './guidedTabTour.config';

describe('guidedTabTour.config', () => {
  it('covers every sidebar tab route', () => {
    expect(GUIDED_TAB_GUIDES.map((guide) => guide.route)).toEqual([
      '/dashboard',
      '/settings',
      '/discovery',
      '/analysis',
      '/business-flows',
      '/recommendations',
      '/finance',
      '/simulations',
      '/drift',
      '/simulations/runbooks',
      '/simulations/pra-exercises',
      '/incidents',
      '/documents',
      '/report',
      '/knowledge-base',
    ]);
  });

  it('resolves nested routes using longest matching prefix', () => {
    expect(resolveGuidedTab('/simulations/runbooks/abc-123')?.id).toBe('runbooks');
    expect(resolveGuidedTab('/simulations/pra-exercises/session-42')?.id).toBe('pra-exercises');
    expect(resolveGuidedTab('/recommendations/remediation')?.id).toBe('recommendations');
  });

  it('returns null for routes without guided panel', () => {
    expect(resolveGuidedTab('/')).toBeNull();
    expect(resolveGuidedTab('/login')).toBeNull();
  });

  it('builds tenant-scoped storage keys', () => {
    const guide = resolveGuidedTab('/analysis');
    expect(guide).not.toBeNull();
    if (!guide) return;

    expect(buildGuidedTabStorageKey(guide, 'scope_test')).toBe(
      'stronghold:guided-tab:dismissed:scope_test:analysis'
    );
  });
});
