import type { NodeType } from '@/types/graph.types';

export const NODE_COLOR_MAP: Record<NodeType, string> = {
  VM: 'hsl(220 70% 50%)',
  CONTAINER: 'hsl(220 70% 50%)',
  SERVERLESS: 'hsl(280 68% 60%)',
  KUBERNETES_CLUSTER: 'hsl(220 70% 50%)',
  DATABASE: 'hsl(262 83% 58%)',
  CACHE: 'hsl(262 83% 58%)',
  LOAD_BALANCER: 'hsl(38 92% 50%)',
  API_GATEWAY: 'hsl(220 70% 50%)',
  VPC: 'hsl(38 92% 50%)',
  SUBNET: 'hsl(38 92% 50%)',
  OBJECT_STORAGE: 'hsl(142 76% 36%)',
  MESSAGE_QUEUE: 'hsl(280 68% 60%)',
  CDN: 'hsl(38 92% 50%)',
  DNS: 'hsl(38 92% 50%)',
  FIREWALL: 'hsl(0 84% 60%)',
  THIRD_PARTY_API: 'hsl(200 20% 50%)',
  SAAS_SERVICE: 'hsl(200 20% 50%)',
  PHYSICAL_SERVER: 'hsl(220 70% 50%)',
  REGION: 'hsl(38 92% 50%)',
  AVAILABILITY_ZONE: 'hsl(38 92% 50%)',
  APPLICATION: 'hsl(220 70% 50%)',
  MICROSERVICE: 'hsl(220 70% 50%)',
};

export const NODE_BG_CLASS_MAP: Record<NodeType, string> = {
  VM: 'bg-node-compute',
  CONTAINER: 'bg-node-compute',
  SERVERLESS: 'bg-node-serverless',
  KUBERNETES_CLUSTER: 'bg-node-compute',
  DATABASE: 'bg-node-database',
  CACHE: 'bg-node-database',
  LOAD_BALANCER: 'bg-node-network',
  API_GATEWAY: 'bg-node-compute',
  VPC: 'bg-node-network',
  SUBNET: 'bg-node-network',
  OBJECT_STORAGE: 'bg-node-storage',
  MESSAGE_QUEUE: 'bg-node-serverless',
  CDN: 'bg-node-network',
  DNS: 'bg-node-network',
  FIREWALL: 'bg-node-network',
  THIRD_PARTY_API: 'bg-node-external',
  SAAS_SERVICE: 'bg-node-external',
  PHYSICAL_SERVER: 'bg-node-compute',
  REGION: 'bg-node-network',
  AVAILABILITY_ZONE: 'bg-node-network',
  APPLICATION: 'bg-node-compute',
  MICROSERVICE: 'bg-node-compute',
};

export function getStatusColor(status: 'down' | 'degraded' | 'healthy'): string {
  switch (status) {
    case 'down': return 'hsl(0 84% 60%)';
    case 'degraded': return 'hsl(38 92% 50%)';
    case 'healthy': return 'hsl(142 76% 36%)';
  }
}
