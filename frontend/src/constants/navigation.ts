import type { TabDefinition, TabId } from "../types";
import type { NavLink } from "../components/navigation/NavMenu";

export type ModuleRoute = TabDefinition & {
  path: string;
};

export const MODULE_ROUTES: ModuleRoute[] = [
  { id: "services", label: "Services", description: "Catalogue et criticité", path: "/services" },
  { id: "continuity", label: "Continuité", description: "Sauvegardes & politiques", path: "/continuity" },
  { id: "bia", label: "BIA", description: "Processus & impacts", path: "/bia" },
  { id: "incidents", label: "Incidents", description: "Crises & notifications", path: "/incidents" },
  { id: "documents", label: "Documents", description: "Upload & extraction", path: "/documents" },
  { id: "discovery", label: "Découverte", description: "Scan réseau & imports", path: "/discovery" },
  { id: "rag", label: "RAG/PRA", description: "Questions & contexte", path: "/rag" },
  { id: "runbooks", label: "Runbooks", description: "Génération & exports", path: "/runbooks" },
  { id: "analysis", label: "Analyse PRA", description: "Contrôles et risques", path: "/analysis" },
  { id: "risks", label: "Risques", description: "Menaces & matrices", path: "/risks" },
  { id: "graph", label: "Graphes", description: "Dépendances", path: "/graph" },
  { id: "architecture", label: "Architecture", description: "Vue d'ensemble", path: "/architecture" },
  { id: "landing", label: "Landing Zone", description: "Infrastructure", path: "/landing" },
  { id: "scenarios", label: "Scénarios", description: "Runbooks", path: "/scenarios" },
  { id: "auth", label: "Auth (ADMIN)", description: "Gestion des clés API (ADMIN only)", path: "/auth" },
  { id: "audit", label: "Audit (ADMIN)", description: "Historique des appels API", path: "/audit" },
];

export const MAIN_NAV_LINKS: NavLink[] = [
  { id: "home", label: "Accueil", to: "/" },
  { id: "configuration", label: "Configuration", to: "/configuration" },
  { id: "navigation", label: "Navigation", to: "/navigation" },
  { id: "services", label: "Services", to: "/services" },
  { id: "documents", label: "Documents", to: "/documents" },
  { id: "rag", label: "RAG/PRA", to: "/rag" },
  { id: "runbooks", label: "Runbooks", to: "/runbooks" },
  { id: "analysis", label: "Analyse", to: "/analysis" },
  { id: "graph", label: "Graphes", to: "/graph" },
  { id: "architecture", label: "Architecture", to: "/architecture" },
  { id: "scenarios", label: "Scénarios", to: "/scenarios" },
];

export const MODULE_PATHS = MODULE_ROUTES.reduce<Record<TabId, string>>((acc, module) => {
  acc[module.id] = module.path;
  return acc;
}, {} as Record<TabId, string>);

export const MODULE_PATH_TO_ID = MODULE_ROUTES.reduce<Record<string, TabId>>((acc, module) => {
  acc[module.path] = module.id;
  return acc;
}, {} as Record<string, TabId>);
