import { useCallback, useEffect, useState } from 'react';

interface AsyncState<TValue> {
  readonly data: TValue | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly retry: () => void;
}

export function useAsync<TValue>(
  fetcher: () => Promise<TValue>,
): AsyncState<TValue> {
  const [data, setData] = useState<TValue | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError : new Error(String(caughtError)));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void execute();
  }, [execute, nonce]);

  const retry = useCallback(() => {
    setNonce((current) => current + 1);
  }, []);

  return { data, error, isLoading, retry };
}
