import { DiscoveryPage } from "../routes/DiscoveryPage";

interface DiscoverySectionProps {
  configVersion: number;
}

export function DiscoverySection({ configVersion }: DiscoverySectionProps) {
  return <DiscoveryPage configVersion={configVersion} />;
}
