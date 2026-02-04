import { useCallback, useEffect, useState } from "react";
import type { GraphApiResponse } from "../types";
import type { InfrastructureGraphData } from "../types/infrastructureGraph";
import { apiFetch } from "../utils/api";
import { normalizeGraphResponse } from "../utils/graphTransform";

type UseFetchGraphDataOptions = {
  endpoint: string;
  enabled?: boolean;
  refreshKey?: number;
};

type UseFetchGraphDataResult = {
  raw: GraphApiResponse | null;
  data: InfrastructureGraphData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useFetchGraphData({
  endpoint,
  enabled = true,
  refreshKey,
}: UseFetchGraphDataOptions): UseFetchGraphDataResult {
  const [raw, setRaw] = useState<GraphApiResponse | null>(null);
  const [data, setData] = useState<InfrastructureGraphData | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const response = (await apiFetch(endpoint)) as GraphApiResponse;
      setRaw(response);
      setData(normalizeGraphResponse(response));
    } catch (err: any) {
      setError(err.message || "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, [endpoint, enabled]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph, refreshKey]);

  return { raw, data, loading, error, refresh: fetchGraph };
}
