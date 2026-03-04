type IdentityLike = {
  serviceDisplayName?: string | null;
  serviceTechnicalName?: string | null;
  displayName?: string | null;
  technicalName?: string | null;
  businessName?: string | null;
  serviceName?: string | null;
  nodeName?: string | null;
  title?: string | null;
  label?: string | null;
  name?: string | null;
  id?: string | null;
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveIdentityLabels(input: IdentityLike): {
  primary: string;
  secondary: string | null;
} {
  const primary =
    readString(input.serviceDisplayName) ??
    readString(input.displayName) ??
    readString(input.businessName) ??
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
