import type { CloudServiceResolution } from '../types/cloud-service.js';

/**
 * Port for resolving cloud service identity from node metadata.
 * Used by the graph analysis engine to determine managed service
 * exemptions (e.g. DynamoDB is SPOF-exempt by design).
 *
 * Implemented by the DR recommendation engine in server/CLI layer.
 */
export type CloudServiceResolver = (options: {
  readonly provider?: string | null;
  readonly nodeType: string;
  readonly metadata?: unknown;
}) => CloudServiceResolution;
