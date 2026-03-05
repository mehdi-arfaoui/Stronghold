import type { InfraNodeAttrs } from "../../graph/types.js";
import type { DiscoveryCredentials } from "../../services/discoveryTypes.js";

export type MetadataProvider = "aws" | "azure" | "gcp";

export type MetadataEnrichmentCredentials = Pick<
  DiscoveryCredentials,
  "aws" | "azure" | "gcp"
>;

export type MetadataEnrichmentRegions = Partial<Record<MetadataProvider, string>>;

export interface MetadataEnrichmentContext {
  credentials: MetadataEnrichmentCredentials;
  regions?: MetadataEnrichmentRegions;
}

export interface EnrichmentResult {
  enriched: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface Enricher {
  name: string;
  provider: MetadataProvider;
  appliesTo: (node: InfraNodeAttrs) => boolean;
  enrich: (
    nodes: InfraNodeAttrs[],
    credentials: unknown,
    region?: string,
  ) => Promise<EnrichmentResult>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getNodeMetadata(node: InfraNodeAttrs): Record<string, unknown> {
  if (!isRecord(node.metadata)) return {};
  return node.metadata;
}

export function setNodeMetadata(
  node: InfraNodeAttrs,
  patch: Record<string, unknown>,
): void {
  node.metadata = {
    ...getNodeMetadata(node),
    ...patch,
  };
}

export function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveNodeRegion(
  node: InfraNodeAttrs,
  fallbackRegion?: string,
): string | null {
  const metadata = getNodeMetadata(node);
  return (
    readString(node.region) ||
    readString(metadata.region) ||
    readString(metadata.location) ||
    readString(fallbackRegion)
  );
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAccessDeniedError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const name = String(error.name || "");
  const code = String(error.Code || error.code || "");
  const message = String(error.message || "");
  const normalized = `${name} ${code} ${message}`.toLowerCase();
  return normalized.includes("accessdenied") || normalized.includes("access denied");
}
