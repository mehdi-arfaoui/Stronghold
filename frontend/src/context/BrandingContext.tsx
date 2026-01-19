import { createContext, useContext } from "react";
import type { BrandingSettings } from "../types";

export type BrandingContextValue = {
  branding: BrandingSettings | null;
  setBranding: (branding: BrandingSettings | null) => void;
};

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error("useBranding must be used within a BrandingContext provider");
  }
  return context;
}

export const BrandingProvider = BrandingContext.Provider;
