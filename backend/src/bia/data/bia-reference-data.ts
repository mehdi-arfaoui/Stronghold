import { NodeType } from '../../graph/types.js';

export type BiaCriticalityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface BiaMetricByCriticality {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface BiaReferenceEntry {
  nodeTypes: string[];
  keywords: string[];
  category: string;
  rto: BiaMetricByCriticality;
  rpo: BiaMetricByCriticality;
  mtpd: BiaMetricByCriticality;
  description: string;
}

export const BIA_REFERENCE_DATA: BiaReferenceEntry[] = [
  {
    nodeTypes: [NodeType.API_GATEWAY, NodeType.APPLICATION, NodeType.MICROSERVICE],
    keywords: ['payment', 'transaction', 'checkout', 'billing', 'card'],
    category: 'Transactions financieres',
    rto: { low: 120, medium: 60, high: 30, critical: 15 },
    rpo: { low: 30, medium: 15, high: 5, critical: 1 },
    mtpd: { low: 240, medium: 120, high: 60, critical: 30 },
    description:
      'Les services de paiement exigent des objectifs de reprise agressifs pour limiter les pertes.',
  },
  {
    nodeTypes: [NodeType.DATABASE],
    keywords: ['postgres', 'mysql', 'mongo', 'oracle', 'database', 'db'],
    category: 'Base de donnees',
    rto: { low: 180, medium: 60, high: 30, critical: 15 },
    rpo: { low: 60, medium: 15, high: 5, critical: 1 },
    mtpd: { low: 360, medium: 120, high: 60, critical: 30 },
    description:
      'Les donnees transactionnelles imposent un RPO tres faible et une reprise rapide.',
  },
  {
    nodeTypes: [NodeType.CACHE],
    keywords: ['redis', 'cache', 'memcached'],
    category: 'Cache distribue',
    rto: { low: 60, medium: 20, high: 10, critical: 5 },
    rpo: { low: 30, medium: 15, high: 10, critical: 5 },
    mtpd: { low: 120, medium: 45, high: 30, critical: 15 },
    description:
      'Un cache critique doit etre restaure rapidement pour eviter la degradation globale.',
  },
  {
    nodeTypes: [NodeType.LOAD_BALANCER],
    keywords: ['lb', 'load balancer', 'alb', 'nlb', 'ingress'],
    category: 'Load Balancer',
    rto: { low: 30, medium: 15, high: 10, critical: 5 },
    rpo: { low: 1440, medium: 1440, high: 720, critical: 720 },
    mtpd: { low: 60, medium: 30, high: 20, critical: 15 },
    description:
      'Composant oriente configuration: le RPO est moins pertinent que la vitesse de bascule.',
  },
  {
    nodeTypes: [NodeType.MESSAGE_QUEUE],
    keywords: ['queue', 'kafka', 'rabbit', 'sqs', 'pubsub'],
    category: 'Message Queue',
    rto: { low: 120, medium: 45, high: 20, critical: 10 },
    rpo: { low: 60, medium: 20, high: 10, critical: 5 },
    mtpd: { low: 240, medium: 90, high: 40, critical: 20 },
    description:
      'Les files de messages critiques doivent reprendre sans accumuler un retard important.',
  },
  {
    nodeTypes: [NodeType.OBJECT_STORAGE, NodeType.FILE_STORAGE],
    keywords: ['storage', 'bucket', 'blob', 'nas'],
    category: 'Stockage',
    rto: { low: 360, medium: 180, high: 90, critical: 45 },
    rpo: { low: 240, medium: 120, high: 60, critical: 15 },
    mtpd: { low: 720, medium: 360, high: 180, critical: 90 },
    description:
      'Les systemes de stockage ont des objectifs de continuite lies au volume et aux sauvegardes.',
  },
  {
    nodeTypes: [NodeType.DNS],
    keywords: ['dns', 'resolver', 'route53', 'cloudflare'],
    category: 'DNS',
    rto: { low: 60, medium: 30, high: 15, critical: 10 },
    rpo: { low: 720, medium: 720, high: 360, critical: 360 },
    mtpd: { low: 180, medium: 60, high: 30, critical: 20 },
    description:
      'Le DNS impacte fortement la disponibilite globale et doit avoir une bascule rapide.',
  },
  {
    nodeTypes: [NodeType.VM, NodeType.CONTAINER, NodeType.PHYSICAL_SERVER, NodeType.SERVERLESS],
    keywords: ['compute', 'app', 'worker', 'api', 'backend'],
    category: 'Compute',
    rto: { low: 360, medium: 180, high: 60, critical: 30 },
    rpo: { low: 240, medium: 120, high: 30, critical: 10 },
    mtpd: { low: 720, medium: 360, high: 120, critical: 60 },
    description:
      'Les workloads compute sont classes selon criticite metier et dependances applicatives.',
  },
  {
    nodeTypes: [NodeType.KUBERNETES_CLUSTER, NodeType.KUBERNETES_POD, NodeType.KUBERNETES_SERVICE],
    keywords: ['k8s', 'kubernetes', 'cluster', 'pod'],
    category: 'Kubernetes',
    rto: { low: 180, medium: 90, high: 45, critical: 20 },
    rpo: { low: 120, medium: 60, high: 20, critical: 5 },
    mtpd: { low: 480, medium: 180, high: 90, critical: 40 },
    description:
      'La reprise Kubernetes depend fortement de la redondance inter-zones et des manifests.',
  },
  {
    nodeTypes: [NodeType.SAAS_SERVICE, NodeType.THIRD_PARTY_API],
    keywords: ['saas', 'salesforce', 'stripe', 'auth0', 'external'],
    category: 'SaaS / API externe',
    rto: { low: 480, medium: 240, high: 90, critical: 45 },
    rpo: { low: 240, medium: 120, high: 60, critical: 15 },
    mtpd: { low: 960, medium: 480, high: 180, critical: 90 },
    description:
      'La continuite depend des SLA fournisseurs et des alternatives contractuelles.',
  },
  {
    nodeTypes: [NodeType.API_GATEWAY],
    keywords: ['gateway', 'api gateway', 'kong', 'apigee'],
    category: 'API Gateway',
    rto: { low: 90, medium: 30, high: 15, critical: 10 },
    rpo: { low: 720, medium: 360, high: 120, critical: 60 },
    mtpd: { low: 180, medium: 60, high: 30, critical: 20 },
    description: 'Point d entree critique, necessite un redemarrage/bascule rapide.',
  },
  {
    nodeTypes: [NodeType.CDN],
    keywords: ['cdn', 'edge', 'cloudfront', 'akamai'],
    category: 'CDN',
    rto: { low: 120, medium: 45, high: 20, critical: 10 },
    rpo: { low: 1440, medium: 720, high: 360, critical: 120 },
    mtpd: { low: 240, medium: 90, high: 40, critical: 20 },
    description:
      'Le CDN ameliore la resilience de diffusion, mais reste critique pour l experience utilisateur.',
  },
  {
    nodeTypes: [NodeType.APPLICATION, NodeType.MICROSERVICE],
    keywords: ['monitoring', 'observability', 'prometheus', 'grafana', 'datadog'],
    category: 'Monitoring',
    rto: { low: 480, medium: 240, high: 120, critical: 60 },
    rpo: { low: 240, medium: 120, high: 60, critical: 30 },
    mtpd: { low: 960, medium: 480, high: 240, critical: 120 },
    description:
      'Le monitoring est essentiel aux operations mais souvent moins critique que le transactionnel.',
  },
  {
    nodeTypes: [],
    keywords: [],
    category: 'Application generique',
    rto: { low: 480, medium: 240, high: 120, critical: 60 },
    rpo: { low: 240, medium: 120, high: 60, critical: 30 },
    mtpd: { low: 960, medium: 480, high: 240, critical: 120 },
    description: 'Fallback generique utilise quand aucun profil specifique n est identifie.',
  },
];
