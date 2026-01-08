import type { TabDefinition, TabId } from "../types";
import type { NavGroup } from "../components/navigation/NavMenu";

export type ModuleRoute = TabDefinition & {
  path: string;
};

export type ModuleGroup = {
  id: string;
  label: string;
  description: string;
  tabs: ModuleRoute[];
};

export const MODULE_ROUTES: ModuleRoute[] = [
  { id: "services", label: "Services", description: "Catalogue et criticité", path: "/services" },
  { id: "discovery", label: "Découverte", description: "Scan réseau & imports", path: "/discovery" },
  { id: "architecture", label: "Architecture", description: "Vue d'ensemble", path: "/architecture" },
  { id: "landing", label: "Landing Zone", description: "Infrastructure", path: "/landing" },
  { id: "graph", label: "Graphes", description: "Dépendances", path: "/graph" },
  { id: "continuity", label: "Continuité", description: "Sauvegardes & politiques", path: "/continuity" },
  { id: "documents", label: "Documents", description: "Upload & extraction", path: "/documents" },
  { id: "rag", label: "RAG/PRA", description: "Questions & contexte", path: "/rag" },
  { id: "bia", label: "BIA", description: "Processus & impacts", path: "/bia" },
  { id: "risks", label: "Risques", description: "Menaces & matrices", path: "/risks" },
  { id: "analysis", label: "Analyse PRA", description: "Contrôles et risques", path: "/analysis" },
  { id: "scenarios", label: "Scénarios", description: "Runbooks", path: "/scenarios" },
  { id: "runbooks", label: "Runbooks", description: "Génération & exports", path: "/runbooks" },
  { id: "incidents", label: "Incidents", description: "Crises & notifications", path: "/incidents" },
  { id: "auth", label: "Auth (ADMIN)", description: "Gestion des clés API (ADMIN only)", path: "/auth" },
  { id: "audit", label: "Audit (ADMIN)", description: "Historique des appels API", path: "/audit" },
];

const MODULE_ROUTE_MAP = MODULE_ROUTES.reduce<Record<TabId, ModuleRoute>>((acc, module) => {
  acc[module.id] = module;
  return acc;
}, {} as Record<TabId, ModuleRoute>);

const createGroup = (
  id: string,
  label: string,
  description: string,
  tabs: TabId[]
): ModuleGroup => ({
  id,
  label,
  description,
  tabs: tabs.map((tabId) => MODULE_ROUTE_MAP[tabId]),
});

export const MODULE_GROUPS: ModuleGroup[] = [
  createGroup(
    "services-infra",
    "Services + Infrastructure",
    "Cartographie des services et fondations techniques.",
    ["services", "discovery", "architecture", "landing", "graph", "continuity"]
  ),
  createGroup(
    "documents-ai",
    "Documents + IA",
    "Collecte documentaire et moteur RAG.",
    ["documents", "rag"]
  ),
  createGroup(
    "analyses-risks",
    "Analyses BIA + Risques",
    "Impacts métiers, menaces et rapports PRA.",
    ["bia", "risks", "analysis"]
  ),
  createGroup(
    "scenarios-runbooks",
    "Scénarios + Runbooks",
    "Plans d'action et orchestration de crise.",
    ["scenarios", "runbooks"]
  ),
  createGroup(
    "incidents",
    "Incidents",
    "Gestion de crise et communications.",
    ["incidents"]
  ),
  createGroup(
    "administration",
    "Administration",
    "Accès, audit et conformité.",
    ["auth", "audit"]
  ),
];

export const WIZARD_STEP_ORDER: TabId[] = [
  "services",
  "documents",
  "bia",
  "risks",
  "scenarios",
  "analysis",
  "runbooks",
];

export const WIZARD_STEP_GROUP: ModuleGroup = createGroup(
  "wizard",
  "Parcours guidé",
  "Suivez l'ordre recommandé pour construire votre PRA.",
  WIZARD_STEP_ORDER
);

export const MAIN_NAV_GROUPS: NavGroup[] = [
  {
    id: "general",
    label: "Général",
    links: [
      { id: "home", label: "Accueil", to: "/" },
      { id: "configuration", label: "Configuration", to: "/configuration" },
      { id: "navigation", label: "Navigation", to: "/navigation" },
    ],
  },
  {
    id: "services-infra",
    label: "Services + Infrastructure",
    links: [
      { id: "services", label: "Services", to: "/services" },
      { id: "discovery", label: "Découverte", to: "/discovery" },
      { id: "architecture", label: "Architecture", to: "/architecture" },
      { id: "landing", label: "Landing Zone", to: "/landing" },
      { id: "graph", label: "Graphes", to: "/graph" },
      { id: "continuity", label: "Continuité", to: "/continuity" },
    ],
  },
  {
    id: "documents-ai",
    label: "Documents + IA",
    links: [
      { id: "documents", label: "Documents", to: "/documents" },
      { id: "rag", label: "RAG/PRA", to: "/rag" },
    ],
  },
  {
    id: "analyses-risks",
    label: "Analyses BIA + Risques",
    links: [
      { id: "bia", label: "BIA", to: "/bia" },
      { id: "risks", label: "Risques", to: "/risks" },
      { id: "analysis", label: "Analyse PRA", to: "/analysis" },
    ],
  },
  {
    id: "scenarios-runbooks",
    label: "Scénarios + Runbooks",
    links: [
      { id: "scenarios", label: "Scénarios", to: "/scenarios" },
      { id: "runbooks", label: "Runbooks", to: "/runbooks" },
    ],
  },
  {
    id: "incidents",
    label: "Incidents",
    links: [{ id: "incidents", label: "Incidents", to: "/incidents" }],
  },
  {
    id: "administration",
    label: "Administration",
    links: [
      { id: "auth", label: "Auth", to: "/auth" },
      { id: "audit", label: "Audit", to: "/audit" },
    ],
  },
];

export const MODULE_PATHS = MODULE_ROUTES.reduce<Record<TabId, string>>((acc, module) => {
  acc[module.id] = module.path;
  return acc;
}, {} as Record<TabId, string>);

export const MODULE_PATH_TO_ID = MODULE_ROUTES.reduce<Record<string, TabId>>((acc, module) => {
  acc[module.path] = module.id;
  return acc;
}, {} as Record<string, TabId>);
