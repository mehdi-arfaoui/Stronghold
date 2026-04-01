export { awsScanner, scanAwsRegion, getAllAwsRegions, resolveRegions } from './aws-scanner.js';
export {
  createAwsClient,
  createEfsClient,
  createRoute53Client,
  resolveAwsCredentials,
  type AwsClientOptions,
} from './aws-client-factory.js';
export { transformToScanResult } from './graph-bridge.js';
export { paginateAws, buildResource, processInBatches, toBusinessTagMap } from './scan-utils.js';
export { getCallerIdentity, type CallerIdentity } from './get-caller-identity.js';

export {
  dynamoDbPitrEnricher,
  ec2AsgEnricher,
  elasticacheFailoverEnricher,
  s3ReplicationEnricher,
  type Enricher,
  type EnrichmentResult,
  type MetadataEnrichmentContext,
  type MetadataEnrichmentCredentials,
  type MetadataEnrichmentRegions,
  type MetadataProvider,
} from './enrichers/index.js';
