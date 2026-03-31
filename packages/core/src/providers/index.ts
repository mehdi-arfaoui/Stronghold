export type {
  CloudProviderAdapter,
  ScanOutput,
  ScanOptions,
  DiscoveryProgress,
  ProgressCallback,
} from './provider-interface.js';

export {
  awsScanner,
  scanAwsRegion,
  transformToScanResult,
  createAwsClient,
  createEfsClient,
  createRoute53Client,
  resolveAwsCredentials,
  paginateAws,
  buildResource,
  type AwsClientOptions,
  type Enricher,
  type EnrichmentResult,
  type MetadataEnrichmentContext,
  type MetadataEnrichmentCredentials,
  type MetadataEnrichmentRegions,
  type MetadataProvider,
  dynamoDbPitrEnricher,
  ec2AsgEnricher,
  elasticacheFailoverEnricher,
  s3ReplicationEnricher,
} from './aws/index.js';

export {
  AzureScanner,
  AzureScannerNotImplementedError,
  azureScanner,
  createAzureClients,
  createAzureCredential,
  type AzureClientFactoryOptions,
  type AzureClientSet,
} from './azure/index.js';
