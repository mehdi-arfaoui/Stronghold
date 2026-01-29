import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiFetch } from "../utils/api";
import type { DiscoveryJob } from "../types";

const DISCOVERY_COMPLETED_KEY = "stronghold_discovery_completed";

type DiscoveryContextValue = {
  discoveryCompleted: boolean;
  setDiscoveryCompleted: (completed: boolean) => void;
  isLoading: boolean;
  checkDiscoveryStatus: () => Promise<void>;
};

const DiscoveryContext = createContext<DiscoveryContextValue | undefined>(undefined);

type DiscoveryProviderProps = {
  initialCompleted?: boolean;
  children: ReactNode;
};

function loadPersistedState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISCOVERY_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistState(completed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISCOVERY_COMPLETED_KEY, String(completed));
  } catch {
    // Ignore storage errors
  }
}

export function DiscoveryProvider({ initialCompleted = false, children }: DiscoveryProviderProps) {
  const [discoveryCompleted, setDiscoveryCompletedState] = useState(
    initialCompleted || loadPersistedState()
  );
  const [isLoading, setIsLoading] = useState(true);

  const setDiscoveryCompleted = useCallback((completed: boolean) => {
    setDiscoveryCompletedState(completed);
    persistState(completed);
  }, []);

  // Check discovery status from backend on mount
  const checkDiscoveryStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      // Check if there are any completed discovery jobs
      const history = (await apiFetch("/discovery/history")) as DiscoveryJob[];
      const hasCompletedJob = history.some((job) => job.status === "COMPLETED");

      if (hasCompletedJob) {
        setDiscoveryCompleted(true);
      }
    } catch (err) {
      // If API fails, rely on persisted state
      console.warn("Could not check discovery status:", err);
    } finally {
      setIsLoading(false);
    }
  }, [setDiscoveryCompleted]);

  // Check status on mount
  useEffect(() => {
    void checkDiscoveryStatus();
  }, [checkDiscoveryStatus]);

  const value = useMemo(
    () => ({
      discoveryCompleted,
      setDiscoveryCompleted,
      isLoading,
      checkDiscoveryStatus,
    }),
    [discoveryCompleted, setDiscoveryCompleted, isLoading, checkDiscoveryStatus]
  );

  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>;
}

export function useDiscovery() {
  const context = useContext(DiscoveryContext);
  if (!context) {
    throw new Error("useDiscovery must be used within a DiscoveryProvider");
  }
  return context;
}
