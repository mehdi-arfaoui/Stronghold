import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type DiscoveryContextValue = {
  discoveryCompleted: boolean;
  setDiscoveryCompleted: (completed: boolean) => void;
};

const DiscoveryContext = createContext<DiscoveryContextValue | undefined>(undefined);

type DiscoveryProviderProps = {
  initialCompleted?: boolean;
  children: ReactNode;
};

export function DiscoveryProvider({ initialCompleted = false, children }: DiscoveryProviderProps) {
  const [discoveryCompleted, setDiscoveryCompletedState] = useState(initialCompleted);

  const setDiscoveryCompleted = useCallback((completed: boolean) => {
    setDiscoveryCompletedState(completed);
  }, []);

  const value = useMemo(
    () => ({
      discoveryCompleted,
      setDiscoveryCompleted,
    }),
    [discoveryCompleted, setDiscoveryCompleted]
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
