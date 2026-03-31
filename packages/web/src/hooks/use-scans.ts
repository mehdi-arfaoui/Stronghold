import type { ApiListScansResult } from '@stronghold-dr/core';
import { useCallback } from 'react';

import { listScans } from '@/api/scans';

import { useAsync } from './use-async';

export function useScans(options: {
  readonly limit?: number;
  readonly cursor?: string;
} = {}): {
  readonly data: ApiListScansResult | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly retry: () => void;
} {
  const { cursor, limit } = options;
  const fetchScans = useCallback(
    () => listScans({ cursor, limit }),
    [cursor, limit],
  );

  return useAsync(fetchScans);
}
