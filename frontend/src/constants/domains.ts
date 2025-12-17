import type { ServiceDomain } from "../types";

export const SERVICE_DOMAINS: readonly ServiceDomain[] = [
  { value: "APP", label: "Application", icon: "🟦" },
  { value: "DB", label: "Base de données", icon: "🗄️" },
  { value: "NETWORK", label: "Réseau", icon: "🌐" },
  { value: "SECURITY", label: "Sécurité", icon: "🛡️" },
  { value: "IAC", label: "IaC", icon: "🧱" },
  { value: "GOV", label: "Gouvernance", icon: "⚖️" },
  { value: "SAAS", label: "SaaS", icon: "☁️" },
  { value: "DATA", label: "Data / ETL", icon: "📊" },
];

export const domainMetaByValue: Record<string, ServiceDomain> =
  SERVICE_DOMAINS.reduce((acc, domain) => {
    acc[domain.value] = domain;
    return acc;
  }, {} as Record<string, ServiceDomain>);
