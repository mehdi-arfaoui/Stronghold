import type { TabDefinition, TabId } from "../types";
import type { NavGroup } from "../components/navigation/NavMenu";
import type { Language } from "../i18n/translations";
import { GENERAL_NAV_LABELS, MODULE_GROUP_LABELS, MODULE_LABELS } from "../i18n/translations";

export type ModuleRoute = TabDefinition & {
  path: string;
};

export type ModuleGroup = {
  id: string;
  label: string;
  description: string;
  tabs: ModuleRoute[];
};

const MODULE_ROUTE_BASE: Array<{ id: TabId; path: string }> = [
  { id: "services", path: "/services" },
  { id: "discovery", path: "/discovery" },
  { id: "architecture", path: "/architecture" },
  { id: "landing", path: "/landing" },
  { id: "graph", path: "/graph" },
  { id: "continuity", path: "/continuity" },
  { id: "documents", path: "/documents" },
  { id: "rag", path: "/rag" },
  { id: "bia", path: "/bia" },
  { id: "risks", path: "/risks" },
  { id: "analysis", path: "/analysis" },
  { id: "scenarios", path: "/scenarios" },
  { id: "runbooks", path: "/runbooks" },
  { id: "incidents", path: "/incidents" },
  { id: "auth", path: "/auth" },
  { id: "audit", path: "/audit" },
];

const MODULE_ROUTE_MAP = MODULE_ROUTE_BASE.reduce<Record<TabId, { id: TabId; path: string }>>(
  (acc, module) => {
    acc[module.id] = module;
    return acc;
  },
  {} as Record<TabId, { id: TabId; path: string }>
);

const createGroup = (id: string, tabs: TabId[]): ModuleGroup => ({
  id,
  label: "",
  description: "",
  tabs: tabs.map((tabId) => MODULE_ROUTE_MAP[tabId] as ModuleRoute),
});

const MODULE_GROUP_BASE = [
  createGroup("services-infra", [
    "services",
    "discovery",
    "architecture",
    "landing",
    "graph",
    "continuity",
  ]),
  createGroup("documents-ai", ["documents", "rag"]),
  createGroup("analyses-risks", ["bia", "risks", "analysis"]),
  createGroup("scenarios-runbooks", ["scenarios", "runbooks"]),
  createGroup("incidents", ["incidents"]),
  createGroup("administration", ["auth", "audit"]),
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

export const WIZARD_STEP_GROUP_ID = "wizard";

export const MODULE_PATHS = MODULE_ROUTE_BASE.reduce<Record<TabId, string>>((acc, module) => {
  acc[module.id] = module.path;
  return acc;
}, {} as Record<TabId, string>);

export const MODULE_PATH_TO_ID = MODULE_ROUTE_BASE.reduce<Record<string, TabId>>((acc, module) => {
  acc[module.path] = module.id;
  return acc;
}, {} as Record<string, TabId>);

export const MODULE_ROUTES = MODULE_ROUTE_BASE;

export const getModuleRoutes = (language: Language): ModuleRoute[] =>
  MODULE_ROUTE_BASE.map((module) => ({
    ...module,
    ...MODULE_LABELS[language][module.id],
  }));

export const getModuleGroups = (language: Language): ModuleGroup[] => {
  const groupLabels = MODULE_GROUP_LABELS[language];
  return MODULE_GROUP_BASE.map((group) => ({
    ...group,
    label: groupLabels[group.id]?.label ?? group.id,
    description: groupLabels[group.id]?.description ?? "",
    tabs: group.tabs.map((tab) => ({
      ...tab,
      ...MODULE_LABELS[language][tab.id],
    })),
  }));
};

export const getWizardStepGroup = (language: Language): ModuleGroup => {
  const groupLabels = MODULE_GROUP_LABELS[language];
  const tabs = WIZARD_STEP_ORDER.map((tabId) => ({
    ...MODULE_ROUTE_MAP[tabId],
    ...MODULE_LABELS[language][tabId],
  }));

  return {
    id: WIZARD_STEP_GROUP_ID,
    label: groupLabels[WIZARD_STEP_GROUP_ID]?.label ?? WIZARD_STEP_GROUP_ID,
    description: groupLabels[WIZARD_STEP_GROUP_ID]?.description ?? "",
    tabs,
  };
};

export const getMainNavGroups = (language: Language): NavGroup[] => {
  const groupLabels = MODULE_GROUP_LABELS[language];
  const generalLabels = GENERAL_NAV_LABELS[language];
  return [
    {
      id: "general",
      label: groupLabels.general?.label ?? "General",
      links: [
        { id: "home", label: generalLabels.home, to: "/" },
        { id: "configuration", label: generalLabels.configuration, to: "/configuration" },
        { id: "navigation", label: generalLabels.navigation, to: "/navigation" },
      ],
    },
    {
      id: "services-infra",
      label: groupLabels["services-infra"]?.label ?? "Services",
      links: [
        { id: "services", label: MODULE_LABELS[language].services.label, to: "/services" },
        { id: "discovery", label: MODULE_LABELS[language].discovery.label, to: "/discovery" },
        { id: "architecture", label: MODULE_LABELS[language].architecture.label, to: "/architecture" },
        { id: "landing", label: MODULE_LABELS[language].landing.label, to: "/landing" },
        { id: "graph", label: MODULE_LABELS[language].graph.label, to: "/graph" },
        { id: "continuity", label: MODULE_LABELS[language].continuity.label, to: "/continuity" },
      ],
    },
    {
      id: "documents-ai",
      label: groupLabels["documents-ai"]?.label ?? "Documents",
      links: [
        { id: "documents", label: MODULE_LABELS[language].documents.label, to: "/documents" },
        { id: "rag", label: MODULE_LABELS[language].rag.label, to: "/rag" },
      ],
    },
    {
      id: "analyses-risks",
      label: groupLabels["analyses-risks"]?.label ?? "Analysis",
      links: [
        { id: "bia", label: MODULE_LABELS[language].bia.label, to: "/bia" },
        { id: "risks", label: MODULE_LABELS[language].risks.label, to: "/risks" },
        { id: "analysis", label: MODULE_LABELS[language].analysis.label, to: "/analysis" },
      ],
    },
    {
      id: "scenarios-runbooks",
      label: groupLabels["scenarios-runbooks"]?.label ?? "Scenarios",
      links: [
        { id: "scenarios", label: MODULE_LABELS[language].scenarios.label, to: "/scenarios" },
        { id: "runbooks", label: MODULE_LABELS[language].runbooks.label, to: "/runbooks" },
      ],
    },
    {
      id: "incidents",
      label: groupLabels.incidents?.label ?? "Incidents",
      links: [{ id: "incidents", label: MODULE_LABELS[language].incidents.label, to: "/incidents" }],
    },
    {
      id: "administration",
      label: groupLabels.administration?.label ?? "Administration",
      links: [
        { id: "auth", label: MODULE_LABELS[language].auth.label, to: "/auth" },
        { id: "audit", label: MODULE_LABELS[language].audit.label, to: "/audit" },
      ],
    },
  ];
};
