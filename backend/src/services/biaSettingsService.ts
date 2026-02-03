import type { PrismaClient } from "@prisma/client";

export interface ProcessTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  defaultRtoHours: number;
  defaultRpoMinutes: number;
  defaultMtpdHours: number;
  suggestedFinancialImpact: number;
  suggestedRegulatoryImpact: number;
  isBuiltIn: boolean;
  isActive: boolean;
}

export interface CriticalityThreshold {
  level: "critical" | "high" | "medium" | "low";
  minScore: number;
  maxScore: number;
  color: string;
  label: string;
  actionRequired: boolean;
  notifyOnCreate: boolean;
}

export interface AlertConfiguration {
  id: string;
  type: "criticality_change" | "rto_breach" | "coverage_gap" | "risk_increase" | "incident_impact";
  isEnabled: boolean;
  threshold?: number;
  recipients: string[];
  channels: ("email" | "slack" | "teams" | "webhook")[];
  frequency: "immediate" | "hourly" | "daily" | "weekly";
}

export interface DisplayPreferences {
  defaultTab: "dashboard" | "wizard" | "prioritization" | "reports" | "integration" | "list";
  showCriticalOnly: boolean;
  defaultSortField: string;
  defaultSortOrder: "asc" | "desc";
  itemsPerPage: number;
  showImpactMatrix: boolean;
  dashboardRefreshInterval: number; // seconds, 0 = manual
  chartColors: {
    critical: string;
    high: string;
    medium: string;
    low: string;
  };
}

export interface BiaSettings {
  tenantId: string;
  processTemplates: ProcessTemplate[];
  criticalityThresholds: CriticalityThreshold[];
  alertConfigurations: AlertConfiguration[];
  displayPreferences: DisplayPreferences;
  lastUpdated: Date;
  updatedBy: string | null;
}

// Default built-in process templates
const DEFAULT_PROCESS_TEMPLATES: Omit<ProcessTemplate, "id">[] = [
  {
    name: "Traitement de la paie",
    description: "Processus de calcul et versement des salaires",
    category: "rh",
    defaultRtoHours: 24,
    defaultRpoMinutes: 60,
    defaultMtpdHours: 72,
    suggestedFinancialImpact: 4,
    suggestedRegulatoryImpact: 4,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Facturation clients",
    description: "Émission et suivi des factures clients",
    category: "finance",
    defaultRtoHours: 4,
    defaultRpoMinutes: 30,
    defaultMtpdHours: 24,
    suggestedFinancialImpact: 5,
    suggestedRegulatoryImpact: 3,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Gestion des commandes",
    description: "Réception et traitement des commandes clients",
    category: "commercial",
    defaultRtoHours: 2,
    defaultRpoMinutes: 15,
    defaultMtpdHours: 8,
    suggestedFinancialImpact: 5,
    suggestedRegulatoryImpact: 2,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Support client",
    description: "Assistance et résolution des demandes clients",
    category: "commercial",
    defaultRtoHours: 1,
    defaultRpoMinutes: 30,
    defaultMtpdHours: 4,
    suggestedFinancialImpact: 3,
    suggestedRegulatoryImpact: 2,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Gestion des stocks",
    description: "Suivi et approvisionnement des stocks",
    category: "logistique",
    defaultRtoHours: 8,
    defaultRpoMinutes: 60,
    defaultMtpdHours: 24,
    suggestedFinancialImpact: 4,
    suggestedRegulatoryImpact: 1,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Comptabilité générale",
    description: "Tenue des comptes et clôtures",
    category: "finance",
    defaultRtoHours: 24,
    defaultRpoMinutes: 60,
    defaultMtpdHours: 168,
    suggestedFinancialImpact: 3,
    suggestedRegulatoryImpact: 5,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Messagerie électronique",
    description: "Service de messagerie d'entreprise",
    category: "it",
    defaultRtoHours: 2,
    defaultRpoMinutes: 15,
    defaultMtpdHours: 8,
    suggestedFinancialImpact: 3,
    suggestedRegulatoryImpact: 2,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "ERP / Système de gestion",
    description: "Application de gestion centrale",
    category: "it",
    defaultRtoHours: 1,
    defaultRpoMinutes: 5,
    defaultMtpdHours: 4,
    suggestedFinancialImpact: 5,
    suggestedRegulatoryImpact: 4,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Site web public",
    description: "Vitrine et portail client",
    category: "it",
    defaultRtoHours: 4,
    defaultRpoMinutes: 60,
    defaultMtpdHours: 24,
    suggestedFinancialImpact: 3,
    suggestedRegulatoryImpact: 2,
    isBuiltIn: true,
    isActive: true,
  },
  {
    name: "Conformité réglementaire",
    description: "Suivi et respect des obligations légales",
    category: "juridique",
    defaultRtoHours: 24,
    defaultRpoMinutes: 120,
    defaultMtpdHours: 168,
    suggestedFinancialImpact: 2,
    suggestedRegulatoryImpact: 5,
    isBuiltIn: true,
    isActive: true,
  },
];

const DEFAULT_CRITICALITY_THRESHOLDS: CriticalityThreshold[] = [
  {
    level: "critical",
    minScore: 4.0,
    maxScore: 5.0,
    color: "#dc2626",
    label: "Critique",
    actionRequired: true,
    notifyOnCreate: true,
  },
  {
    level: "high",
    minScore: 3.0,
    maxScore: 3.99,
    color: "#f59e0b",
    label: "Élevé",
    actionRequired: true,
    notifyOnCreate: true,
  },
  {
    level: "medium",
    minScore: 2.0,
    maxScore: 2.99,
    color: "#3b82f6",
    label: "Modéré",
    actionRequired: false,
    notifyOnCreate: false,
  },
  {
    level: "low",
    minScore: 0,
    maxScore: 1.99,
    color: "#22c55e",
    label: "Faible",
    actionRequired: false,
    notifyOnCreate: false,
  },
];

const DEFAULT_ALERT_CONFIGURATIONS: Omit<AlertConfiguration, "id">[] = [
  {
    type: "criticality_change",
    isEnabled: true,
    recipients: [],
    channels: ["email"],
    frequency: "immediate",
  },
  {
    type: "rto_breach",
    isEnabled: true,
    threshold: 80, // % of RTO
    recipients: [],
    channels: ["email", "slack"],
    frequency: "immediate",
  },
  {
    type: "coverage_gap",
    isEnabled: true,
    recipients: [],
    channels: ["email"],
    frequency: "daily",
  },
  {
    type: "risk_increase",
    isEnabled: true,
    threshold: 15, // risk score threshold
    recipients: [],
    channels: ["email"],
    frequency: "immediate",
  },
  {
    type: "incident_impact",
    isEnabled: true,
    recipients: [],
    channels: ["email", "slack"],
    frequency: "immediate",
  },
];

const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  defaultTab: "dashboard",
  showCriticalOnly: false,
  defaultSortField: "criticalityScore",
  defaultSortOrder: "desc",
  itemsPerPage: 25,
  showImpactMatrix: true,
  dashboardRefreshInterval: 0,
  chartColors: {
    critical: "#dc2626",
    high: "#f59e0b",
    medium: "#3b82f6",
    low: "#22c55e",
  },
};

// In-memory settings storage (would typically be in database)
const settingsCache = new Map<string, BiaSettings>();

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function getBiaSettings(
  prisma: PrismaClient,
  tenantId: string
): Promise<BiaSettings> {
  // Check cache first
  if (settingsCache.has(tenantId)) {
    return settingsCache.get(tenantId)!;
  }

  // Return default settings if not cached
  const defaultSettings: BiaSettings = {
    tenantId,
    processTemplates: DEFAULT_PROCESS_TEMPLATES.map((t) => ({
      ...t,
      id: generateId(),
    })),
    criticalityThresholds: DEFAULT_CRITICALITY_THRESHOLDS,
    alertConfigurations: DEFAULT_ALERT_CONFIGURATIONS.map((a) => ({
      ...a,
      id: generateId(),
    })),
    displayPreferences: DEFAULT_DISPLAY_PREFERENCES,
    lastUpdated: new Date(),
    updatedBy: null,
  };

  settingsCache.set(tenantId, defaultSettings);
  return defaultSettings;
}

export async function updateProcessTemplates(
  prisma: PrismaClient,
  tenantId: string,
  templates: ProcessTemplate[]
): Promise<ProcessTemplate[]> {
  const settings = await getBiaSettings(prisma, tenantId);

  // Keep built-in templates, update/add custom ones
  const builtInTemplates = settings.processTemplates.filter((t) => t.isBuiltIn);
  const customTemplates = templates.filter((t) => !t.isBuiltIn);

  settings.processTemplates = [...builtInTemplates, ...customTemplates];
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return settings.processTemplates;
}

export async function addProcessTemplate(
  prisma: PrismaClient,
  tenantId: string,
  template: Omit<ProcessTemplate, "id" | "isBuiltIn">
): Promise<ProcessTemplate> {
  const settings = await getBiaSettings(prisma, tenantId);

  const newTemplate: ProcessTemplate = {
    ...template,
    id: generateId(),
    isBuiltIn: false,
  };

  settings.processTemplates.push(newTemplate);
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return newTemplate;
}

export async function deleteProcessTemplate(
  prisma: PrismaClient,
  tenantId: string,
  templateId: string
): Promise<boolean> {
  const settings = await getBiaSettings(prisma, tenantId);

  const template = settings.processTemplates.find((t) => t.id === templateId);
  if (!template || template.isBuiltIn) {
    return false; // Can't delete built-in templates
  }

  settings.processTemplates = settings.processTemplates.filter((t) => t.id !== templateId);
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return true;
}

export async function updateCriticalityThresholds(
  prisma: PrismaClient,
  tenantId: string,
  thresholds: CriticalityThreshold[]
): Promise<CriticalityThreshold[]> {
  const settings = await getBiaSettings(prisma, tenantId);

  settings.criticalityThresholds = thresholds;
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return settings.criticalityThresholds;
}

export async function updateAlertConfigurations(
  prisma: PrismaClient,
  tenantId: string,
  configs: AlertConfiguration[]
): Promise<AlertConfiguration[]> {
  const settings = await getBiaSettings(prisma, tenantId);

  settings.alertConfigurations = configs;
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return settings.alertConfigurations;
}

export async function updateDisplayPreferences(
  prisma: PrismaClient,
  tenantId: string,
  preferences: Partial<DisplayPreferences>
): Promise<DisplayPreferences> {
  const settings = await getBiaSettings(prisma, tenantId);

  settings.displayPreferences = {
    ...settings.displayPreferences,
    ...preferences,
  };
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return settings.displayPreferences;
}

export async function toggleTemplateActive(
  prisma: PrismaClient,
  tenantId: string,
  templateId: string,
  isActive: boolean
): Promise<ProcessTemplate | null> {
  const settings = await getBiaSettings(prisma, tenantId);

  const template = settings.processTemplates.find((t) => t.id === templateId);
  if (!template) return null;

  template.isActive = isActive;
  settings.lastUpdated = new Date();

  settingsCache.set(tenantId, settings);
  return template;
}

export async function resetToDefaults(
  prisma: PrismaClient,
  tenantId: string,
  section?: "templates" | "thresholds" | "alerts" | "display"
): Promise<BiaSettings> {
  const settings = await getBiaSettings(prisma, tenantId);

  if (!section || section === "templates") {
    settings.processTemplates = DEFAULT_PROCESS_TEMPLATES.map((t) => ({
      ...t,
      id: generateId(),
    }));
  }

  if (!section || section === "thresholds") {
    settings.criticalityThresholds = DEFAULT_CRITICALITY_THRESHOLDS;
  }

  if (!section || section === "alerts") {
    settings.alertConfigurations = DEFAULT_ALERT_CONFIGURATIONS.map((a) => ({
      ...a,
      id: generateId(),
    }));
  }

  if (!section || section === "display") {
    settings.displayPreferences = DEFAULT_DISPLAY_PREFERENCES;
  }

  settings.lastUpdated = new Date();
  settingsCache.set(tenantId, settings);

  return settings;
}
