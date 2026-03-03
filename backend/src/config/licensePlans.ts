export type LicensePlan = 'starter' | 'pro' | 'enterprise';

export const LICENSE_FEATURES = {
  discovery: 'discovery',
  bia: 'bia',
  resilienceScore: 'resilience-score',
  warRoomPreset: 'war-room-preset',
  recommendations: 'recommendations',
  reportPdf: 'report-pdf',
  driftDetection: 'drift-detection',
  warRoomCustom: 'war-room-custom',
  warRoomUnlimited: 'war-room-unlimited',
  reportDocx: 'report-docx',
  complianceMapping: 'compliance-mapping',
  executiveDashboard: 'executive-dashboard',
  runbooks: 'runbooks',
  financialAdvanced: 'financial-advanced',
  apiExport: 'api-export',
  warRoomScheduled: 'war-room-scheduled',
  reportCustomTemplates: 'report-custom-templates',
  sso: 'sso',
  multiTenancy: 'multi-tenancy',
  auditTrailExport: 'audit-trail-export',
} as const;

export type LicenseFeature = (typeof LICENSE_FEATURES)[keyof typeof LICENSE_FEATURES];

export type LicensePlanDefinition = {
  plan: LicensePlan;
  maxNodes: number;
  maxUsers: number;
  maxCloudEnvs: number;
  features: LicenseFeature[];
};

export const LICENSE_PLAN_DEFINITIONS: Record<LicensePlan, LicensePlanDefinition> = {
  starter: {
    plan: 'starter',
    maxNodes: 50,
    maxUsers: 3,
    maxCloudEnvs: 1,
    features: [
      LICENSE_FEATURES.discovery,
      LICENSE_FEATURES.bia,
      LICENSE_FEATURES.resilienceScore,
      LICENSE_FEATURES.warRoomPreset,
      LICENSE_FEATURES.recommendations,
      LICENSE_FEATURES.reportPdf,
      LICENSE_FEATURES.driftDetection,
    ],
  },
  pro: {
    plan: 'pro',
    maxNodes: 200,
    maxUsers: 20,
    maxCloudEnvs: 3,
    features: [
      LICENSE_FEATURES.discovery,
      LICENSE_FEATURES.bia,
      LICENSE_FEATURES.resilienceScore,
      LICENSE_FEATURES.warRoomPreset,
      LICENSE_FEATURES.recommendations,
      LICENSE_FEATURES.reportPdf,
      LICENSE_FEATURES.driftDetection,
      LICENSE_FEATURES.warRoomCustom,
      LICENSE_FEATURES.warRoomUnlimited,
      LICENSE_FEATURES.reportDocx,
      LICENSE_FEATURES.complianceMapping,
      LICENSE_FEATURES.executiveDashboard,
      LICENSE_FEATURES.runbooks,
      LICENSE_FEATURES.financialAdvanced,
      LICENSE_FEATURES.apiExport,
    ],
  },
  enterprise: {
    plan: 'enterprise',
    maxNodes: -1,
    maxUsers: -1,
    maxCloudEnvs: -1,
    features: [
      LICENSE_FEATURES.discovery,
      LICENSE_FEATURES.bia,
      LICENSE_FEATURES.resilienceScore,
      LICENSE_FEATURES.warRoomPreset,
      LICENSE_FEATURES.recommendations,
      LICENSE_FEATURES.reportPdf,
      LICENSE_FEATURES.driftDetection,
      LICENSE_FEATURES.warRoomCustom,
      LICENSE_FEATURES.warRoomUnlimited,
      LICENSE_FEATURES.reportDocx,
      LICENSE_FEATURES.complianceMapping,
      LICENSE_FEATURES.executiveDashboard,
      LICENSE_FEATURES.runbooks,
      LICENSE_FEATURES.financialAdvanced,
      LICENSE_FEATURES.apiExport,
      LICENSE_FEATURES.warRoomScheduled,
      LICENSE_FEATURES.reportCustomTemplates,
      LICENSE_FEATURES.sso,
      LICENSE_FEATURES.multiTenancy,
      LICENSE_FEATURES.auditTrailExport,
    ],
  },
};

export const LEGACY_FEATURE_ALIASES: Record<string, LicenseFeature> = {
  inventory: LICENSE_FEATURES.discovery,
  pra: LICENSE_FEATURES.runbooks,
  graph_analysis: LICENSE_FEATURES.resilienceScore,
  report_pra_pca: LICENSE_FEATURES.reportPdf,
};
