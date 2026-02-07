import {
  Server,
  Container,
  Zap,
  Box,
  Database,
  MemoryStick,
  GitBranch,
  Globe,
  Network,
  HardDrive,
  MessageSquare,
  Radio,
  Globe2,
  Shield,
  ExternalLink,
  Cloud,
  MapPin,
  AppWindow,
  Boxes,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NodeType } from '@/types/graph.types';

const NODE_ICONS: Record<NodeType, LucideIcon> = {
  VM: Server,
  CONTAINER: Container,
  SERVERLESS: Zap,
  KUBERNETES_CLUSTER: Box,
  DATABASE: Database,
  CACHE: MemoryStick,
  LOAD_BALANCER: GitBranch,
  API_GATEWAY: Globe,
  VPC: Network,
  SUBNET: Network,
  OBJECT_STORAGE: HardDrive,
  MESSAGE_QUEUE: MessageSquare,
  CDN: Radio,
  DNS: Globe2,
  FIREWALL: Shield,
  THIRD_PARTY_API: ExternalLink,
  SAAS_SERVICE: Cloud,
  PHYSICAL_SERVER: Server,
  REGION: MapPin,
  AVAILABILITY_ZONE: MapPin,
  APPLICATION: AppWindow,
  MICROSERVICE: Boxes,
};

interface NodeIconProps {
  type: NodeType;
  className?: string;
  style?: React.CSSProperties;
}

export function NodeIcon({ type, className, style }: NodeIconProps) {
  const Icon = NODE_ICONS[type] || Server;
  return <Icon className={className} style={style} />;
}

export { NODE_ICONS };
