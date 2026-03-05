type IdentityLike = {
  serviceDisplayName?: string | null;
  serviceTechnicalName?: string | null;
  displayName?: string | null;
  technicalName?: string | null;
  businessName?: string | null;
  tagName?: string | null;
  logicalName?: string | null;
  inferredName?: string | null;
  serviceName?: string | null;
  nodeName?: string | null;
  title?: string | null;
  label?: string | null;
  name?: string | null;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractTagName(metadata: Record<string, unknown>): string | null {
  const tags = toRecord(metadata.tags);
  return (
    readString(metadata.tagName) ||
    readString(metadata.resourceLabel) ||
    readString(tags.Name) ||
    readString(tags.name) ||
    null
  );
}

export function resolveIdentityLabels(input: IdentityLike): {
  primary: string;
  secondary: string | null;
} {
  const metadata = toRecord(input.metadata);
  const primary =
    readString(input.businessName) ??
    readString(input.serviceDisplayName) ??
    readString(input.displayName) ??
    readString(input.tagName) ??
    extractTagName(metadata) ??
    readString(input.logicalName) ??
    readString(input.inferredName) ??
    readString(metadata.displayName) ??
    readString(input.serviceName) ??
    readString(input.nodeName) ??
    readString(input.title) ??
    readString(input.label) ??
    readString(input.name) ??
    readString(input.id) ??
    'Service';
  const technical =
    readString(input.serviceTechnicalName) ??
    readString(input.technicalName) ??
    readString(input.name) ??
    readString(input.nodeName);

  return {
    primary,
    secondary: technical && technical !== primary ? technical : null,
  };
}
