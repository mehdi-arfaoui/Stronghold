import type { TabDefinition, TabId } from "../types";
import type { NavGroup } from "../components/navigation/NavMenu";
import type { TFunction } from "i18next";

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
  { id: "compliance", path: "/compliance" },
  { id: "financier", path: "/financier" },
  { id: "scenarios", path: "/scenarios" },
  { id: "runbooks", path: "/runbooks" },
  { id: "incidents", path: "/incidents" },
  { id: "auth", path: "/auth" },
  { id: "audit", path: "/audit" },
  { id: "branding", path: "/branding" },
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
  createGroup("analyses-risks", ["bia", "risks", "analysis", "compliance", "financier"]),
  createGroup("scenarios-runbooks", ["scenarios", "runbooks"]),
  createGroup("incidents", ["incidents"]),
  createGroup("administration", ["auth", "audit", "branding"]),
];

export const WIZARD_STEP_ORDER: TabId[] = [
  "discovery",
  "services",
  "documents",
  "rag",
  "bia",
  "risks",
  "scenarios",
  "runbooks",
  "analysis",
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

export const getModuleRoutes = (t: TFunction): ModuleRoute[] =>
  MODULE_ROUTE_BASE.map((module) => ({
    ...module,
    label: t(`modules.${module.id}.label`),
    description: t(`modules.${module.id}.description`),
  }));

export const getModuleGroups = (t: TFunction): ModuleGroup[] => {
  return MODULE_GROUP_BASE.map((group) => ({
    ...group,
    label: t(`moduleGroups.${group.id}.label`, { defaultValue: group.id }),
    description: t(`moduleGroups.${group.id}.description`, { defaultValue: "" }),
    tabs: group.tabs.map((tab) => ({
      ...tab,
      label: t(`modules.${tab.id}.label`),
      description: t(`modules.${tab.id}.description`),
    })),
  }));
};

export const getWizardStepGroup = (t: TFunction): ModuleGroup => {
  const tabs = WIZARD_STEP_ORDER.map((tabId) => ({
    ...MODULE_ROUTE_MAP[tabId],
    label: t(`modules.${tabId}.label`),
    description: t(`modules.${tabId}.description`),
  }));

  return {
    id: WIZARD_STEP_GROUP_ID,
    label: t(`moduleGroups.${WIZARD_STEP_GROUP_ID}.label`, {
      defaultValue: WIZARD_STEP_GROUP_ID,
    }),
    description: t(`moduleGroups.${WIZARD_STEP_GROUP_ID}.description`, { defaultValue: "" }),
    tabs,
  };
};

export const getMainNavGroups = (t: TFunction): NavGroup[] => {
  return [
    {
      id: "general",
      label: t("moduleGroups.general.label", { defaultValue: "General" }),
      links: [
        { id: "home", label: t("generalNav.home"), to: "/" },
        { id: "configuration", label: t("generalNav.configuration"), to: "/configuration" },
        { id: "compliance", label: t("generalNav.compliance"), to: "/compliance" },
      ],
    },
  ];
};
