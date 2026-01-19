import type { BrandingSettings } from "../types";

const BRANDING_VARIABLES: Record<keyof BrandingSettings, string[]> = {
  logoUrl: [],
  primaryColor: ["--primary-color"],
  secondaryColor: ["--secondary-color"],
  accentColor: [
    "--accent-color",
    "--color-accent-100",
    "--color-accent-300",
    "--color-accent-500",
    "--color-accent-700",
  ],
};

export function applyBranding(branding: BrandingSettings | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  (Object.keys(BRANDING_VARIABLES) as Array<keyof BrandingSettings>).forEach((key) => {
    if (key === "logoUrl") return;
    const value = branding?.[key];
    BRANDING_VARIABLES[key].forEach((variable) => {
      if (value) {
        root.style.setProperty(variable, value);
      } else {
        root.style.removeProperty(variable);
      }
    });
  });
}
