import type { ApiScanSummary } from '@stronghold-dr/core';
import { useCallback, useEffect, useState } from 'react';

import { APIError } from '@/api/client';
import { getScanSummary } from '@/api/scans';

interface UseScanResult {
  readonly scan: ApiScanSummary | null;
  readonly error: APIError | null;
  readonly isLoading: boolean;
  readonly isPending: boolean;
  readonly retry: () => void;
}

export function useScan(scanId: string | null): UseScanResult {
  const [scan, setScan] = useState<ApiScanSummary | null>(null);
  const [error, setError] = useState<APIError | null>(null);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => {
    setScan(null);
    setError(null);
    setNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    const resolvedScanId = scanId;
    if (!resolvedScanId) {
      setScan(null);
      setError(null);
      return;
    }
    const activeScanId = resolvedScanId;

    let cancelled = false;
    let attempt = 0;

    async function poll(): Promise<void> {
      while (!cancelled) {
        try {
          const data = await getScanSummary(activeScanId);
          if (cancelled) {
            return;
          }

          setScan(data);
          setError(null);

          if (data.status === 'COMPLETED' || data.status === 'FAILED') {
            return;
          }
        } catch (caughtError) {
          if (cancelled) {
            return;
          }

          setError(
            caughtError instanceof APIError
              ? caughtError
              : new APIError(0, 'SCAN_POLL_FAILED', String(caughtError)),
          );
          return;
        }

        attempt += 1;
        const delayMs = attempt <= 3 ? 1000 : attempt <= 5 ? 3000 : 5000;
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    }

    void poll();

    return () => {
      cancelled = true;
    };
  }, [scanId, nonce]);

  return {
    scan,
    error,
    isLoading: scan === null && error === null,
    isPending: scan?.status === 'PENDING' || scan?.status === 'RUNNING',
    retry,
  };
}
