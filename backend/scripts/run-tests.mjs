import { spawnSync } from 'node:child_process';

const suite = process.argv[2] ?? 'unit';
const extraArgs = process.argv.slice(3);
const includeDemoTests = process.env.BUILD_TARGET === 'internal';

const unitBase = [
  'tests/authMiddleware.test.ts',
  'tests/authService.test.ts',
  'tests/aiFlowSuggester.service.test.ts',
  'tests/awsMultiRegion.test.cjs',
  'tests/classificationService.test.js',
  'tests/cloudEnrichment.service.test.ts',
  'tests/companyFinancialProfile.service.test.ts',
  'tests/dependencyInferenceAndDowntimeDistribution.test.ts',
  'tests/dependencyRiskEngine.test.js',
  'tests/discoveryConnectors.test.cjs',
  'tests/discoveryOrchestrator.postScanEnrichments.test.ts',
  'tests/discoveryWorker.graphSync.test.ts',
  'tests/documentIngestionService.test.js',
  'tests/documentIntelligenceService.test.js',
  'tests/drStrategyEngine.test.js',
  'tests/financialDashboard.validation.test.ts',
  'tests/graphBridge.awsClassifications.test.ts',
  'tests/graphServiceIdentification.test.ts',
  'tests/helpers.test.js',
  'tests/landingZoneCostOptimization.test.ts',
  'tests/licenseMiddleware.test.ts',
  'tests/licenseRoutes.test.ts',
  'tests/ocrService.test.js',
  'tests/openAiAnalyzer.test.js',
  'tests/paginateAws.test.ts',
  'tests/pricingSummary.test.js',
  'tests/ragFusion.test.js',
  'tests/ragServicePrompt.test.js',
  'tests/runbookGeneratorService.test.ts',
  'tests/sensitiveDataScanService.test.js',
  'tests/simulationEngine.ransomware.test.ts',
];

const unitDemo = [
  'tests/demo/demoInfrastructureFactory.test.ts',
  'tests/demo/demoOnboardingService.test.ts',
  'tests/demo/demoProfiles.config.test.ts',
];

const integrationBase = [
  'tests/authRoutes.test.ts',
  'tests/biaRoutes.test.js',
  'tests/businessFlowFinancialEngine.test.ts',
  'tests/businessFlowRoutes.test.ts',
  'tests/classificationFeedbackRoutes.test.js',
  'tests/devRoutes.test.ts',
  'tests/discoveryResilienceRoutes.autoScan.test.ts',
  'tests/discoveryResilienceRoutes.cloudScan.test.ts',
  'tests/discoveryRoutes.test.js',
  'tests/documentIntelligenceIntegration.test.js',
  'tests/documentRoutesSensitivityReport.test.js',
  'tests/documentRoutesUpload.test.js',
  'tests/exerciseRoutes.test.js',
  'tests/extractedFactService.test.js',
  'tests/financialEngine.test.ts',
  'tests/financialEngineBusinessFlows.test.ts',
  'tests/financialMultiTenantE2E.test.ts',
  'tests/incidentRoutes.test.js',
  'tests/licenseService.test.ts',
  'tests/riskRoutes.test.js',
  'tests/tenantIsolation.test.js',
];

const integrationDemo = [
  'tests/demo/discoveryResilienceRoutes.demoSeed.test.ts',
  'tests/demo/financialConsistency.integration.test.ts',
];

const suites = {
  unit: includeDemoTests ? [...unitBase, ...unitDemo] : unitBase,
  integration: includeDemoTests ? [...integrationBase, ...integrationDemo] : integrationBase,
};

const files = suites[suite];
if (!files) {
  console.error(`Unknown test suite: ${suite}`);
  process.exit(1);
}

const command = process.execPath;
const result = spawnSync(
  command,
  [
    'node_modules/tsx/dist/cli.mjs',
    '--test',
    '--test-timeout=5000',
    '--test-force-exit',
    ...files,
    ...extraArgs,
  ],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (result.error) {
  console.error(result.error);
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
