import type { ValidationReport } from '@stronghold-dr/core';
import { useCallback } from 'react';

import { getValidationReport } from '@/api/reports';

import { useAsync } from './use-async';

export function useReport(scanId: string | null): {
  readonly data: ValidationReport | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly retry: () => void;
} {
  const fetchReport = useCallback(async () => {
      if (!scanId) {
        return null;
      }
      return getValidationReport(scanId);
    }, [scanId]);

  return useAsync(fetchReport);
}
