/**
 * Demo seed service for Stronghold.
 * Generates a realistic e-commerce environment "ShopMax" with ~45 nodes and ~55 edges.
 *
 * SPOF INTENTIONNELS :
 *   1. Payment DB : PAS de replica, PAS de multi-AZ
 *   2. API Gateway : point d'entree unique
 *   3. ERP Legacy : serveur unique on-premise
 *   4. Redis Cache : instance unique, pas de cluster
 *
 * BONS PATTERNS (pour contraste) :
 *   - User DB : Multi-AZ + 1 read replica
 *   - Catalog DB : 2 read replicas
 *   - S3 : replication cross-region
 *   - EKS : multi-AZ, auto-scaling
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { detectRisks } from '../graph/riskDetectionEngine.js';
import { ensureBaselineSnapshot } from '../drift/driftDetectionService.js';
import { BusinessFlowFinancialEngineService } from './business-flow-financial-engine.service.js';
import { appLogger } from "../utils/logger.js";

interface NodeDef {
  id: string;
  externalId: string;
  name: string;
  type: string;
  provider: string;
  region?: string;
  availabilityZone?: string;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
}

interface EdgeDef {
  sourceId: string;
  targetId: string;
  type: string;
  confidence?: number;
  inferenceMethod?: string;
  confirmed?: boolean;
}

interface DemoFlowNodeDef {
  infraNodeId: string;
  role: string;
  isCritical?: boolean;
  hasAlternativePath?: boolean;
  alternativeNodeId?: string | null;
}

interface DemoBusinessFlowDef {
  name: string;
  description: string;
  category: string;
  annualRevenue?: number | null;
  transactionsPerHour?: number | null;
  revenuePerTransaction?: number | null;
  estimatedCostPerHour?: number | null;
  peakHoursMultiplier?: number;
  peakHoursStart?: number | null;
  peakHoursEnd?: number | null;
  operatingDaysPerWeek?: number;
  operatingHoursPerDay?: number;
  slaUptimePercent?: number | null;
  slaPenaltyPerHour?: number | null;
  slaPenaltyFlat?: number | null;
  contractualRTO?: number | null;
  estimatedCustomerChurnPerHour?: number | null;
  customerLifetimeValue?: number | null;
  reputationImpactCategory?: string | null;
  source: 'manual' | 'ai_suggested' | 'cloud_tags' | 'imported';
  aiConfidence?: number | null;
  validatedByUser?: boolean;
  mutualExclusionGroup?: string | null;
  nodes: DemoFlowNodeDef[];
}

const nodes: NodeDef[] = [
  // -- REGIONS --
  {
    id: "region-eu-west-1",
    externalId: "aws:region:eu-west-1",
    name: "eu-west-1 (Ireland)",
    type: "REGION",
    provider: "aws",
    region: "eu-west-1",
    tags: {},
    metadata: {},
  },
  {
    id: "region-eu-central-1",
    externalId: "aws:region:eu-central-1",
    name: "eu-central-1 (Frankfurt)",
    type: "REGION",
    provider: "aws",
    region: "eu-central-1",
    tags: {},
    metadata: {},
  },

  // -- VPC --
  {
    id: "vpc-prod",
    externalId: "arn:aws:ec2:eu-west-1:123456:vpc/vpc-prod",
    name: "vpc-production",
    type: "VPC",
    provider: "aws",
    region: "eu-west-1",
    tags: { env: "production" },
    metadata: { cidr: "10.0.0.0/16" },
  },
  {
    id: "vpc-dr",
    externalId: "arn:aws:ec2:eu-central-1:123456:vpc/vpc-dr",
    name: "vpc-disaster-recovery",
    type: "VPC",
    provider: "aws",
    region: "eu-central-1",
    tags: { env: "dr" },
    metadata: { cidr: "10.1.0.0/16" },
  },

  // -- SUBNETS --
  {
    id: "subnet-pub-1a",
    externalId: "arn:aws:ec2:eu-west-1:123456:subnet/subnet-pub-1a",
    name: "subnet-public-1a",
    type: "SUBNET",
    provider: "aws",
    region: "eu-west-1",
    availabilityZone: "eu-west-1a",
    tags: { tier: "public" },
    metadata: { cidr: "10.0.1.0/24" },
  },
  {
    id: "subnet-priv-1a",
    externalId: "arn:aws:ec2:eu-west-1:123456:subnet/subnet-priv-1a",
    name: "subnet-private-1a",
    type: "SUBNET",
    provider: "aws",
    region: "eu-west-1",
    availabilityZone: "eu-west-1a",
    tags: { tier: "private" },
    metadata: { cidr: "10.0.10.0/24" },
  },
  {
    id: "subnet-priv-1b",
    externalId: "arn:aws:ec2:eu-west-1:123456:subnet/subnet-priv-1b",
    name: "subnet-private-1b",
    type: "SUBNET",
    provider: "aws",
    region: "eu-west-1",
    availabilityZone: "eu-west-1b",
    tags: { tier: "private" },
    metadata: { cidr: "10.0.11.0/24" },
  },

  // -- CDN --
  {
    id: "cloudflare-cdn",
    externalId: "cloudflare:zone:shopmax.com",
    name: "Cloudflare CDN",
    type: "CDN",
    provider: "manual",
    tags: { service: "cdn" },
    metadata: { domain: "shopmax.com" },
  },

  // -- LOAD BALANCERS --
  {
    id: "alb-prod",
    externalId: "arn:aws:elasticloadbalancing:eu-west-1:123456:loadbalancer/app/alb-prod",
    name: "alb-production",
    type: "LOAD_BALANCER",
    provider: "aws",
    region: "eu-west-1",
    tags: { env: "production", app: "shopmax" },
    metadata: { scheme: "internet-facing", type: "application" },
  },
  {
    id: "alb-dr",
    externalId: "arn:aws:elasticloadbalancing:eu-central-1:123456:loadbalancer/app/alb-dr",
    name: "alb-disaster-recovery",
    type: "LOAD_BALANCER",
    provider: "aws",
    region: "eu-central-1",
    tags: { env: "dr", app: "shopmax" },
    metadata: { scheme: "internet-facing", type: "application", status: "standby" },
  },

  // -- KUBERNETES (EKS) --
  {
    id: "eks-prod",
    externalId: "arn:aws:eks:eu-west-1:123456:cluster/eks-production",
    name: "eks-production",
    type: "KUBERNETES_CLUSTER",
    provider: "aws",
    region: "eu-west-1",
    tags: { env: "production" },
    metadata: { version: "1.28", nodeCount: 6, isMultiAZ: true },
  },

  // -- MICROSERVICES --
  {
    id: "svc-api-gateway",
    externalId: "k8s:deployment/api-gateway",
    name: "api-gateway",
    type: "MICROSERVICE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "frontend", team: "platform" },
    metadata: { replicas: 3, image: "shopmax/api-gateway:2.4.1", cpu: "500m", memory: "512Mi" },
  },
  {
    id: "svc-payment",
    externalId: "k8s:deployment/payment-service",
    name: "payment-service",
    type: "MICROSERVICE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "backend", team: "payments", critical: "true" },
    metadata: { replicas: 2, image: "shopmax/payment:3.1.0", cpu: "1000m", memory: "1Gi" },
  },
  {
    id: "svc-user",
    externalId: "k8s:deployment/user-service",
    name: "user-service",
    type: "MICROSERVICE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "backend", team: "identity" },
    metadata: { replicas: 3, image: "shopmax/user:2.8.0", cpu: "500m", memory: "512Mi" },
  },
  {
    id: "svc-catalog",
    externalId: "k8s:deployment/catalog-service",
    name: "catalog-service",
    type: "MICROSERVICE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "backend", team: "catalog" },
    metadata: { replicas: 3, image: "shopmax/catalog:4.0.2", cpu: "500m", memory: "1Gi" },
  },
  {
    id: "svc-order",
    externalId: "k8s:deployment/order-service",
    name: "order-service",
    type: "MICROSERVICE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "backend", team: "orders", critical: "true" },
    metadata: { replicas: 2, image: "shopmax/order:3.5.1", cpu: "750m", memory: "768Mi" },
  },
  {
    id: "svc-notification",
    externalId: "k8s:deployment/notification-service",
    name: "notification-service",
    type: "MICROSERVICE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "backend", team: "comms" },
    metadata: { replicas: 2, image: "shopmax/notification:1.9.0", cpu: "250m", memory: "256Mi" },
  },
  {
    id: "svc-admin",
    externalId: "k8s:deployment/admin-dashboard",
    name: "admin-dashboard",
    type: "APPLICATION",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", tier: "frontend", team: "internal" },
    metadata: { replicas: 1, image: "shopmax/admin:2.1.0", cpu: "250m", memory: "256Mi" },
  },

  // -- DATABASES --
  {
    id: "db-payment",
    externalId: "arn:aws:rds:eu-west-1:123456:db/payment-db",
    name: "payment-db",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    availabilityZone: "eu-west-1a",
    tags: { app: "shopmax", service: "payment", critical: "true" },
    metadata: {
      engine: "PostgreSQL 15.4", instanceType: "db.r6g.large",
      isMultiAZ: false, replicaCount: 0,
      isPubliclyAccessible: false, status: "available", storageGB: 500, iops: 3000,
    },
  },
  {
    id: "db-user",
    externalId: "arn:aws:rds:eu-west-1:123456:db/user-db",
    name: "user-db",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "user" },
    metadata: {
      engine: "PostgreSQL 15.4", instanceType: "db.r6g.large",
      isMultiAZ: true, replicaCount: 1,
      isPubliclyAccessible: false, status: "available", storageGB: 200,
    },
  },
  {
    id: "db-user-replica",
    externalId: "arn:aws:rds:eu-west-1:123456:db/user-db-replica",
    name: "user-db-replica",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    availabilityZone: "eu-west-1b",
    tags: { app: "shopmax", service: "user", role: "replica" },
    metadata: {
      engine: "PostgreSQL 15.4", instanceType: "db.r6g.medium",
      isMultiAZ: false, replicaCount: 0, status: "available",
    },
  },
  {
    id: "db-catalog",
    externalId: "arn:aws:rds:eu-west-1:123456:db/catalog-db",
    name: "catalog-db",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "catalog" },
    metadata: {
      engine: "MySQL 8.0", instanceType: "db.r6g.xlarge",
      isMultiAZ: true, replicaCount: 2, status: "available", storageGB: 1000,
    },
  },
  {
    id: "db-order",
    externalId: "arn:aws:rds:eu-west-1:123456:db/order-db",
    name: "order-db",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "order" },
    metadata: {
      engine: "PostgreSQL 15.4", instanceType: "db.r6g.large",
      isMultiAZ: true, replicaCount: 1, status: "available", storageGB: 300,
    },
  },
  {
    id: "db-admin",
    externalId: "arn:aws:rds:eu-west-1:123456:db/admin-db",
    name: "admin-db",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "admin" },
    metadata: {
      engine: "PostgreSQL 15.4", instanceType: "db.t4g.medium",
      isMultiAZ: false, replicaCount: 0, status: "available", storageGB: 50,
    },
  },

  // -- CACHE --
  {
    id: "redis-main",
    externalId: "arn:aws:elasticache:eu-west-1:123456:cluster/redis-main",
    name: "redis-main",
    type: "CACHE",
    provider: "aws",
    region: "eu-west-1",
    availabilityZone: "eu-west-1a",
    tags: { app: "shopmax", service: "cache" },
    metadata: {
      engine: "Redis 7.0", instanceType: "cache.r6g.large",
      isMultiAZ: false, replicaCount: 0, status: "available",
    },
  },

  // -- ELASTICSEARCH --
  {
    id: "es-catalog",
    externalId: "arn:aws:es:eu-west-1:123456:domain/catalog-search",
    name: "catalog-search (Elasticsearch)",
    type: "DATABASE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "search" },
    metadata: {
      engine: "OpenSearch 2.11", instanceType: "r6g.large.search",
      isMultiAZ: true, replicaCount: 2, status: "available",
    },
  },

  // -- SERVERLESS --
  {
    id: "lambda-image",
    externalId: "arn:aws:lambda:eu-west-1:123456:function/image-processor",
    name: "image-processor",
    type: "SERVERLESS",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "media" },
    metadata: { runtime: "nodejs20.x", memoryMB: 1024, timeoutSec: 30 },
  },

  // -- STORAGE --
  {
    id: "s3-images",
    externalId: "arn:aws:s3:::shopmax-product-images",
    name: "shopmax-product-images",
    type: "OBJECT_STORAGE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "media" },
    metadata: { versioning: true, crossRegionReplication: true, encryptionType: "AES256" },
  },
  {
    id: "s3-backups",
    externalId: "arn:aws:s3:::shopmax-backups",
    name: "shopmax-backups",
    type: "OBJECT_STORAGE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "backup" },
    metadata: { versioning: true, lifecycleRules: true },
  },

  // -- MESSAGE QUEUES --
  {
    id: "sqs-orders",
    externalId: "arn:aws:sqs:eu-west-1:123456:order-processing-queue",
    name: "order-processing-queue",
    type: "MESSAGE_QUEUE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "orders" },
    metadata: { type: "SQS Standard", visibilityTimeoutSec: 60, retentionDays: 14 },
  },
  {
    id: "sqs-notifications",
    externalId: "arn:aws:sqs:eu-west-1:123456:notification-queue",
    name: "notification-queue",
    type: "MESSAGE_QUEUE",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax", service: "notifications" },
    metadata: { type: "SQS Standard", visibilityTimeoutSec: 30 },
  },

  // -- DNS --
  {
    id: "route53-shopmax",
    externalId: "arn:aws:route53:::hostedzone/Z1234SHOPMAX",
    name: "shopmax.com (Route 53)",
    type: "DNS",
    provider: "aws",
    region: "global",
    tags: { app: "shopmax" },
    metadata: { hostedZone: "shopmax.com", recordCount: 24 },
  },

  // -- MONITORING --
  {
    id: "datadog",
    externalId: "saas:datadog:shopmax",
    name: "Datadog Monitoring",
    type: "SAAS_SERVICE",
    provider: "manual",
    tags: { service: "monitoring" },
    metadata: { plan: "Pro", agentsInstalled: 45 },
  },

  // -- THIRD-PARTY SERVICES --
  {
    id: "stripe-api",
    externalId: "third_party:stripe",
    name: "Stripe Payment API",
    type: "THIRD_PARTY_API",
    provider: "manual",
    tags: { service: "payment", critical: "true" },
    metadata: { sla: "99.99%", apiVersion: "2023-10-16" },
  },
  {
    id: "sendgrid-api",
    externalId: "third_party:sendgrid",
    name: "SendGrid Email API",
    type: "THIRD_PARTY_API",
    provider: "manual",
    tags: { service: "email" },
    metadata: { sla: "99.95%", plan: "Pro 100K" },
  },

  // -- ON-PREMISE --
  {
    id: "erp-server",
    externalId: "onprem:192.168.1.50",
    name: "ERP Legacy Server",
    type: "PHYSICAL_SERVER",
    provider: "on_premise",
    tags: { service: "erp", critical: "true", legacy: "true" },
    metadata: {
      ip: "192.168.1.50", os: "Windows Server 2016",
      cpu: "Xeon E5-2680 v4", memoryGB: 64, status: "running",
    },
  },
  {
    id: "erp-db",
    externalId: "onprem:192.168.1.51",
    name: "ERP Database (SQL Server)",
    type: "DATABASE",
    provider: "on_premise",
    tags: { service: "erp", legacy: "true" },
    metadata: {
      ip: "192.168.1.51", engine: "SQL Server 2019",
      isMultiAZ: false, replicaCount: 0, status: "running",
    },
  },
  {
    id: "vpn-gateway",
    externalId: "onprem:192.168.1.1",
    name: "VPN Gateway",
    type: "NETWORK_DEVICE",
    provider: "on_premise",
    tags: { service: "network" },
    metadata: { ip: "192.168.1.1", model: "Cisco ASA 5516-X" },
  },

  // -- FIREWALL --
  {
    id: "waf-prod",
    externalId: "arn:aws:wafv2:eu-west-1:123456:regional/webacl/shopmax-waf",
    name: "WAF Production",
    type: "FIREWALL",
    provider: "aws",
    region: "eu-west-1",
    tags: { app: "shopmax" },
    metadata: {
      rulesCount: 12,
      managedRules: ["AWSManagedRulesCommonRuleSet", "AWSManagedRulesSQLiRuleSet"],
    },
  },
];

const confirmedEdges: EdgeDef[] = [
  // Containment : Region -> VPC -> Subnet
  { sourceId: "region-eu-west-1", targetId: "vpc-prod", type: "CONTAINS" },
  { sourceId: "region-eu-central-1", targetId: "vpc-dr", type: "CONTAINS" },
  { sourceId: "vpc-prod", targetId: "subnet-pub-1a", type: "CONTAINS" },
  { sourceId: "vpc-prod", targetId: "subnet-priv-1a", type: "CONTAINS" },
  { sourceId: "vpc-prod", targetId: "subnet-priv-1b", type: "CONTAINS" },

  // CDN -> DNS -> ALB
  { sourceId: "cloudflare-cdn", targetId: "route53-shopmax", type: "ROUTES_TO" },
  { sourceId: "route53-shopmax", targetId: "alb-prod", type: "ROUTES_TO" },
  { sourceId: "route53-shopmax", targetId: "alb-dr", type: "ROUTES_TO" },

  // WAF -> ALB
  { sourceId: "waf-prod", targetId: "alb-prod", type: "ROUTES_TO" },

  // ALB -> EKS
  { sourceId: "alb-prod", targetId: "eks-prod", type: "ROUTES_TO" },
  { sourceId: "eks-prod", targetId: "subnet-priv-1a", type: "RUNS_ON" },
  { sourceId: "eks-prod", targetId: "subnet-priv-1b", type: "RUNS_ON" },

  // EKS -> Microservices
  { sourceId: "svc-api-gateway", targetId: "eks-prod", type: "RUNS_ON" },
  { sourceId: "svc-payment", targetId: "eks-prod", type: "RUNS_ON" },
  { sourceId: "svc-user", targetId: "eks-prod", type: "RUNS_ON" },
  { sourceId: "svc-catalog", targetId: "eks-prod", type: "RUNS_ON" },
  { sourceId: "svc-order", targetId: "eks-prod", type: "RUNS_ON" },
  { sourceId: "svc-notification", targetId: "eks-prod", type: "RUNS_ON" },
  { sourceId: "svc-admin", targetId: "eks-prod", type: "RUNS_ON" },

  // API Gateway -> services
  { sourceId: "svc-api-gateway", targetId: "svc-payment", type: "ROUTES_TO" },
  { sourceId: "svc-api-gateway", targetId: "svc-user", type: "ROUTES_TO" },
  { sourceId: "svc-api-gateway", targetId: "svc-catalog", type: "ROUTES_TO" },
  { sourceId: "svc-api-gateway", targetId: "svc-order", type: "ROUTES_TO" },
  { sourceId: "svc-api-gateway", targetId: "redis-main", type: "CONNECTS_TO" },

  // Services -> Databases
  { sourceId: "svc-payment", targetId: "db-payment", type: "CONNECTS_TO" },
  { sourceId: "svc-payment", targetId: "stripe-api", type: "DEPENDS_ON" },
  { sourceId: "svc-user", targetId: "db-user", type: "CONNECTS_TO" },
  { sourceId: "svc-catalog", targetId: "db-catalog", type: "CONNECTS_TO" },
  { sourceId: "svc-catalog", targetId: "es-catalog", type: "CONNECTS_TO" },
  { sourceId: "svc-order", targetId: "db-order", type: "CONNECTS_TO" },
  { sourceId: "svc-order", targetId: "sqs-orders", type: "PUBLISHES_TO" },
  { sourceId: "svc-notification", targetId: "sqs-notifications", type: "SUBSCRIBES_TO" },
  { sourceId: "svc-notification", targetId: "sendgrid-api", type: "DEPENDS_ON" },
  { sourceId: "svc-admin", targetId: "db-admin", type: "CONNECTS_TO" },

  // Order -> Notification (via queue)
  { sourceId: "svc-order", targetId: "sqs-notifications", type: "PUBLISHES_TO" },

  // DB replication
  { sourceId: "db-user", targetId: "db-user-replica", type: "REPLICATES_TO" },

  // Lambda
  { sourceId: "lambda-image", targetId: "s3-images", type: "CONNECTS_TO" },
  { sourceId: "svc-catalog", targetId: "lambda-image", type: "DEPENDS_ON" },

  // Backups
  { sourceId: "db-user", targetId: "s3-backups", type: "BACKS_UP_TO" },
  { sourceId: "db-catalog", targetId: "s3-backups", type: "BACKS_UP_TO" },
  { sourceId: "db-order", targetId: "s3-backups", type: "BACKS_UP_TO" },

  // On-premise
  { sourceId: "erp-server", targetId: "erp-db", type: "CONNECTS_TO" },
  { sourceId: "svc-order", targetId: "erp-server", type: "DEPENDS_ON" },
  { sourceId: "vpn-gateway", targetId: "vpc-prod", type: "CONNECTS_TO" },
  { sourceId: "erp-server", targetId: "vpn-gateway", type: "CONNECTS_TO" },

  // Monitoring
  { sourceId: "datadog", targetId: "eks-prod", type: "MONITORS" },
  { sourceId: "datadog", targetId: "db-payment", type: "MONITORS" },
  { sourceId: "datadog", targetId: "db-user", type: "MONITORS" },
  { sourceId: "datadog", targetId: "redis-main", type: "MONITORS" },
];

const inferredEdges: EdgeDef[] = [
  {
    sourceId: "svc-admin", targetId: "db-user", type: "CONNECTS_TO",
    confidence: 0.7, inferenceMethod: "tags", confirmed: false,
  },
  {
    sourceId: "svc-admin", targetId: "redis-main", type: "CONNECTS_TO",
    confidence: 0.6, inferenceMethod: "naming", confirmed: false,
  },
  {
    sourceId: "lambda-image", targetId: "sqs-orders", type: "SUBSCRIBES_TO",
    confidence: 0.5, inferenceMethod: "network", confirmed: false,
  },
];

const demoBusinessFlows: DemoBusinessFlowDef[] = [
  {
    name: 'Paiement Client - Carte',
    description: 'Flux principal de paiement par carte bancaire',
    category: 'revenue',
    annualRevenue: 2_400_000,
    peakHoursMultiplier: 1.5,
    peakHoursStart: 9,
    peakHoursEnd: 18,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    slaUptimePercent: 99.95,
    slaPenaltyPerHour: 500,
    contractualRTO: 60,
    estimatedCustomerChurnPerHour: 2,
    customerLifetimeValue: 2400,
    reputationImpactCategory: 'high',
    source: 'manual',
    validatedByUser: true,
    mutualExclusionGroup: 'checkout-payment',
    nodes: [
      { infraNodeId: 'cloudflare-cdn', role: 'entry_point', isCritical: true },
      { infraNodeId: 'route53-shopmax', role: 'entry_point', isCritical: true },
      {
        infraNodeId: 'alb-prod',
        role: 'entry_point',
        isCritical: true,
        hasAlternativePath: true,
        alternativeNodeId: 'alb-dr',
      },
      { infraNodeId: 'svc-api-gateway', role: 'processing', isCritical: true },
      { infraNodeId: 'svc-payment', role: 'processing', isCritical: true },
      { infraNodeId: 'db-payment', role: 'data_store', isCritical: true },
      { infraNodeId: 'stripe-api', role: 'external_dependency', isCritical: true },
    ],
  },
  {
    name: 'Paiement Client - Virement',
    description: 'Flux alternatif de paiement virement/SEPA',
    category: 'revenue',
    estimatedCostPerHour: 650,
    peakHoursMultiplier: 1.4,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    source: 'manual',
    validatedByUser: true,
    mutualExclusionGroup: 'checkout-payment',
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-order', role: 'processing', isCritical: true },
      { infraNodeId: 'erp-server', role: 'external_dependency', isCritical: true },
      { infraNodeId: 'erp-db', role: 'data_store', isCritical: true },
    ],
  },
  {
    name: 'Onboarding Utilisateur',
    description: 'Inscription et activation compte client',
    category: 'revenue',
    transactionsPerHour: 450,
    revenuePerTransaction: 35,
    peakHoursMultiplier: 1.5,
    peakHoursStart: 8,
    peakHoursEnd: 20,
    operatingDaysPerWeek: 7,
    operatingHoursPerDay: 16,
    source: 'manual',
    validatedByUser: true,
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-user', role: 'processing', isCritical: true },
      {
        infraNodeId: 'db-user',
        role: 'data_store',
        isCritical: true,
        hasAlternativePath: true,
        alternativeNodeId: 'db-user-replica',
      },
      { infraNodeId: 'db-user-replica', role: 'data_store', isCritical: false },
    ],
  },
  {
    name: 'Fulfillment Commande',
    description: 'Traitement de commande et notifications clients',
    category: 'operations',
    estimatedCostPerHour: 1800,
    peakHoursMultiplier: 1.4,
    operatingDaysPerWeek: 7,
    operatingHoursPerDay: 24,
    source: 'cloud_tags',
    validatedByUser: false,
    nodes: [
      { infraNodeId: 'svc-api-gateway', role: 'entry_point', isCritical: true },
      { infraNodeId: 'svc-order', role: 'processing', isCritical: true },
      { infraNodeId: 'db-order', role: 'data_store', isCritical: true },
      { infraNodeId: 'sqs-notifications', role: 'notification', isCritical: false },
      { infraNodeId: 'svc-notification', role: 'processing', isCritical: false },
      { infraNodeId: 'sendgrid-api', role: 'external_dependency', isCritical: false },
    ],
  },
  {
    name: 'Reporting BI',
    description: 'Flux de reporting interne et dashboards management',
    category: 'internal',
    estimatedCostPerHour: 220,
    peakHoursMultiplier: 1.2,
    operatingDaysPerWeek: 5,
    operatingHoursPerDay: 10,
    source: 'ai_suggested',
    aiConfidence: 0.72,
    validatedByUser: false,
    nodes: [
      { infraNodeId: 'svc-admin', role: 'entry_point', isCritical: true },
      { infraNodeId: 'db-admin', role: 'data_store', isCritical: true },
      { infraNodeId: 'datadog', role: 'notification', isCritical: false },
    ],
  },
];

async function seedDemoFinancialProfile(prisma: PrismaClient, tenantId: string) {
  await prisma.organizationProfile.upsert({
    where: { tenantId },
    create: {
      tenantId,
      sizeCategory: 'midMarket',
      verticalSector: 'retail_ecommerce',
      customCurrency: 'EUR',
      strongholdPlanId: 'PRO',
      strongholdMonthlyCost: 800,
    },
    update: {
      sizeCategory: 'midMarket',
      verticalSector: 'retail_ecommerce',
      customCurrency: 'EUR',
      strongholdPlanId: 'PRO',
      strongholdMonthlyCost: 800,
    },
  });
}

async function seedDemoBusinessFlows(prisma: PrismaClient, tenantId: string) {
  const requiredNodeIds = Array.from(
    new Set(demoBusinessFlows.flatMap((flow) => flow.nodes.map((node) => node.infraNodeId))),
  );
  const existingNodes = await prisma.infraNode.findMany({
    where: {
      tenantId,
      id: { in: requiredNodeIds },
    },
    select: { id: true },
  });

  const existingNodeIds = new Set(existingNodes.map((node) => node.id));
  const missingNodeIds = requiredNodeIds.filter((nodeId) => !existingNodeIds.has(nodeId));
  if (missingNodeIds.length > 0) {
    throw new Error(`Missing infra nodes for business flows: ${missingNodeIds.join(', ')}`);
  }

  await prisma.businessFlowNode.deleteMany({ where: { tenantId } });
  await prisma.businessFlow.deleteMany({ where: { tenantId } });

  const flowIds: string[] = [];
  let validatedFlows = 0;

  for (const flowDef of demoBusinessFlows) {
    const validatedByUser = flowDef.validatedByUser === true;
    const flow = await prisma.businessFlow.create({
      data: {
        tenantId,
        name: flowDef.name,
        description: flowDef.description,
        category: flowDef.category,
        annualRevenue: flowDef.annualRevenue ?? null,
        transactionsPerHour: flowDef.transactionsPerHour ?? null,
        revenuePerTransaction: flowDef.revenuePerTransaction ?? null,
        estimatedCostPerHour: flowDef.estimatedCostPerHour ?? null,
        peakHoursMultiplier: flowDef.peakHoursMultiplier ?? 1.5,
        peakHoursStart: flowDef.peakHoursStart ?? null,
        peakHoursEnd: flowDef.peakHoursEnd ?? null,
        operatingDaysPerWeek: flowDef.operatingDaysPerWeek ?? 5,
        operatingHoursPerDay: flowDef.operatingHoursPerDay ?? 10,
        slaUptimePercent: flowDef.slaUptimePercent ?? null,
        slaPenaltyPerHour: flowDef.slaPenaltyPerHour ?? null,
        slaPenaltyFlat: flowDef.slaPenaltyFlat ?? null,
        contractualRTO: flowDef.contractualRTO ?? null,
        estimatedCustomerChurnPerHour: flowDef.estimatedCustomerChurnPerHour ?? null,
        customerLifetimeValue: flowDef.customerLifetimeValue ?? null,
        reputationImpactCategory: flowDef.reputationImpactCategory ?? null,
        source: flowDef.source,
        aiConfidence: flowDef.aiConfidence ?? null,
        validatedByUser,
        validatedAt: validatedByUser ? new Date() : null,
        mutualExclusionGroup: flowDef.mutualExclusionGroup ?? null,
      },
    });

    const computed = BusinessFlowFinancialEngineService.calculateFlowCostPerHour(flow);
    await prisma.businessFlow.update({
      where: { id: flow.id },
      data: {
        calculatedCostPerHour: computed ? computed.totalCostPerHour : null,
        costCalculationMethod: computed ? computed.method : null,
      },
    });

    await prisma.businessFlowNode.createMany({
      data: flowDef.nodes.map((flowNode, orderIndex) => ({
        businessFlowId: flow.id,
        infraNodeId: flowNode.infraNodeId,
        tenantId,
        orderIndex,
        role: flowNode.role,
        isCritical: flowNode.isCritical !== false,
        hasAlternativePath: flowNode.hasAlternativePath === true,
        alternativeNodeId: flowNode.alternativeNodeId ?? null,
      })),
    });

    flowIds.push(flow.id);
    if (validatedByUser) validatedFlows += 1;
  }

  await prisma.nodeFinancialOverride.upsert({
    where: {
      nodeId_tenantId: {
        nodeId: 'erp-server',
        tenantId,
      },
    },
    create: {
      tenantId,
      nodeId: 'erp-server',
      customCostPerHour: 12000,
      justification: 'ERP legacy contractual penalties and manual processing fallback',
      validatedBy: 'demo.seed',
      validatedAt: new Date(),
    },
    update: {
      customCostPerHour: 12000,
      justification: 'ERP legacy contractual penalties and manual processing fallback',
      validatedBy: 'demo.seed',
      validatedAt: new Date(),
    },
  });

  const flowEngine = new BusinessFlowFinancialEngineService(prisma);
  const coverage = await flowEngine.calculateFlowsCoverage(tenantId);

  return {
    flowsCreated: flowIds.length,
    validatedFlows,
    unvalidatedFlows: flowIds.length - validatedFlows,
    coveragePercent: coverage.coveragePercent,
    coveredCriticalNodes: coverage.coveredCriticalNodes,
    totalCriticalNodes: coverage.totalCriticalNodes,
    userOverrides: 1,
  };
}

export async function runDemoSeed(prisma: PrismaClient, tenantId: string) {
  appLogger.info('Seeding demo environment "ShopMax E-commerce"...');

  // Clean existing resilience data for this tenant
  appLogger.info('Cleaning existing data...');
  await prisma.riskNodeLink.deleteMany({ where: { risk: { tenantId } } }).catch(() => {});
  await prisma.riskMitigation.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.risk.deleteMany({ where: { tenantId, autoDetected: true } }).catch(() => {});
  await prisma.bIAProcess2.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.bIAReport2.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.graphAnalysis.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.businessFlowNode.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.businessFlow.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.nodeFinancialOverride.deleteMany({ where: { tenantId } }).catch(() => {});
  await prisma.infraEdge.deleteMany({ where: { tenantId } });
  await prisma.infraNode.deleteMany({ where: { tenantId } });
  await prisma.simulation.deleteMany({ where: { tenantId } });
  await prisma.scanJob.deleteMany({ where: { tenantId } });

  appLogger.info(`Creating ${nodes.length} nodes...`);
  await prisma.infraNode.createMany({
    data: nodes.map((node) => ({
      id: node.id,
      externalId: node.externalId,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region ?? null,
      availabilityZone: node.availabilityZone ?? null,
      tags: node.tags as Prisma.InputJsonValue,
      metadata: node.metadata as Prisma.InputJsonValue,
      tenantId,
      lastSeenAt: new Date(),
    })),
  });

  appLogger.info(`Creating ${confirmedEdges.length} confirmed edges...`);
  await prisma.infraEdge.createMany({
    data: confirmedEdges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      confidence: 1.0,
      confirmed: true,
      tenantId,
    })),
  });

  appLogger.info(`Creating ${inferredEdges.length} inferred edges...`);
  await prisma.infraEdge.createMany({
    data: inferredEdges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      confidence: edge.confidence ?? 0.5,
      inferenceMethod: edge.inferenceMethod ?? null,
      confirmed: false,
      tenantId,
    })),
  });

  appLogger.info('Creating completed scan job...');
  await prisma.scanJob.create({
    data: {
      status: 'completed',
      config: {
        providers: [
          { type: 'aws', regions: ['eu-west-1', 'eu-central-1'] },
          { type: 'kubernetes', clusters: ['eks-production'] },
          { type: 'on_premise', ipRanges: ['192.168.1.0/24'] },
        ],
      },
      progress: {
        totalAdapters: 3,
        completedAdapters: 3,
        nodesDiscovered: nodes.length,
        edgesDiscovered: confirmedEdges.length + inferredEdges.length,
      },
      result: {
        nodesCreated: nodes.length,
        edgesCreated: confirmedEdges.length,
        edgesInferred: inferredEdges.length,
        duration: 187000,
      },
      tenantId,
      startedAt: new Date(Date.now() - 187000),
      completedAt: new Date(),
    },
  });

  let resilienceScore = 0;
  let spofCount = 0;
  let biaProcessCount = 0;
  let risksDetected = 0;
  let profileConfigured = false;
  let businessFlowSummary = {
    flowsCreated: 0,
    validatedFlows: 0,
    unvalidatedFlows: 0,
    coveragePercent: 0,
    coveredCriticalNodes: 0,
    totalCriticalNodes: 0,
    userOverrides: 0,
  };

  try {
    appLogger.info('Running post-seed graph analysis...');
    const graph = await GraphService.loadGraphFromDB(prisma, tenantId);

    if (graph.order > 0) {
      const report = await analyzeFullGraph(graph);

      await prisma.graphAnalysis.create({
        data: {
          resilienceScore: report.resilienceScore,
          totalNodes: report.totalNodes,
          totalEdges: report.totalEdges,
          spofCount: report.spofs.length,
          report: JSON.parse(JSON.stringify({
            spofs: report.spofs,
            redundancyIssues: report.redundancyIssues,
            regionalRisks: report.regionalRisks,
            circularDeps: report.circularDeps,
            cascadeChains: report.cascadeChains.slice(0, 20),
            criticalityScores: Object.fromEntries(report.criticalityScores),
          })),
          tenantId,
        },
      });

      await Promise.all(
        [...report.criticalityScores.entries()].map(async ([nodeId, score]) => {
          const spof = report.spofs.find((item) => item.nodeId === nodeId);
          const blast = GraphService.getBlastRadius(graph, nodeId);
          await prisma.infraNode.updateMany({
            where: { id: nodeId, tenantId },
            data: {
              criticalityScore: score,
              isSPOF: Boolean(spof),
              blastRadius: blast.length,
            },
          });
        })
      );

      resilienceScore = report.resilienceScore;
      spofCount = report.spofs.length;
      appLogger.info(`Graph analysis complete: score=${resilienceScore}, SPOFs=${spofCount}`);

      appLogger.info('Generating BIA...');
      const biaReport = generateBIA(graph, report);

      await prisma.bIAReport2.create({
        data: {
          generatedAt: biaReport.generatedAt,
          summary: biaReport.summary as Prisma.InputJsonValue,
          tenantId,
          processes: {
            create: biaReport.processes.map((processItem) => ({
              serviceNodeId: processItem.serviceNodeId,
              serviceName: processItem.serviceName,
              serviceType: processItem.serviceType,
              suggestedMAO: processItem.suggestedMAO,
              suggestedMTPD: processItem.suggestedMTPD,
              suggestedRTO: processItem.suggestedRTO,
              suggestedRPO: processItem.suggestedRPO,
              suggestedMBCO: processItem.suggestedMBCO,
              impactCategory: processItem.impactCategory,
              criticalityScore: processItem.criticalityScore,
              recoveryTier: processItem.recoveryTier,
              dependencyChain: processItem.dependencyChain as unknown as Prisma.InputJsonValue,
              weakPoints: processItem.weakPoints as unknown as Prisma.InputJsonValue,
              financialImpact: processItem.financialImpact as unknown as Prisma.InputJsonValue,
              validationStatus: 'pending',
              tenantId,
            })),
          },
        },
      });

      await Promise.all(
        biaReport.processes.map((processItem) =>
          prisma.infraNode.updateMany({
            where: { id: processItem.serviceNodeId, tenantId },
            data: {
              suggestedRTO: processItem.suggestedRTO,
              suggestedRPO: processItem.suggestedRPO,
              suggestedMTPD: processItem.suggestedMTPD,
              impactCategory: processItem.impactCategory,
              financialImpactPerHour: processItem.financialImpact.estimatedCostPerHour,
            },
          })
        )
      );

      biaProcessCount = biaReport.processes.length;
      appLogger.info(`BIA generated: ${biaProcessCount} processes`);

      appLogger.info('Detecting risks...');
      const detectedRisks = detectRisks(graph, report);
      const validNodeIds = new Set(
        (await prisma.infraNode.findMany({ where: { tenantId }, select: { id: true } })).map((node) => node.id)
      );

      for (const risk of detectedRisks) {
        const createdRisk = await prisma.risk.create({
          data: {
            title: risk.title,
            description: risk.description,
            threatType: risk.category,
            probability: risk.probability,
            impact: risk.impact,
            status: 'open',
            autoDetected: true,
            detectionMethod: risk.detectionMethod,
            tenantId,
          },
        });

        const nodeLinks = risk.linkedNodeIds
          .filter((nodeId) => validNodeIds.has(nodeId))
          .map((nodeId) => ({ riskId: createdRisk.id, nodeId }));
        if (nodeLinks.length > 0) {
          await prisma.riskNodeLink.createMany({ data: nodeLinks });
        }

        const mitigations = risk.mitigations.map((mitigation) => ({
          riskId: createdRisk.id,
          description: mitigation.title,
          status: 'pending',
          tenantId,
        }));
        if (mitigations.length > 0) {
          await prisma.riskMitigation.createMany({ data: mitigations });
        }
      }

      risksDetected = detectedRisks.length;
      appLogger.info(`Risks detected: ${risksDetected}`);
    }
  } catch (error) {
    appLogger.error('Post-seed analysis failed (non-blocking):', error);
  }

  try {
    appLogger.info('Configuring demo financial profile...');
    await seedDemoFinancialProfile(prisma, tenantId);
    profileConfigured = true;

    appLogger.info('Seeding business flows...');
    businessFlowSummary = await seedDemoBusinessFlows(prisma, tenantId);
    appLogger.info(
      `Business flows seeded: ${businessFlowSummary.flowsCreated} ` +
        `(validated=${businessFlowSummary.validatedFlows}, ` +
        `coverage=${businessFlowSummary.coveragePercent}%)`,
    );
  } catch (error) {
    appLogger.error('Business flow seed failed (non-blocking):', error);
  }

  void ensureBaselineSnapshot(prisma, tenantId, 'demo-seed').catch((error) => {
    appLogger.warn('Unable to ensure baseline snapshot after demo seed', {
      tenantId,
      message: error instanceof Error ? error.message : 'unknown',
    });
  });

  const summary = {
    nodes: nodes.length,
    confirmedEdges: confirmedEdges.length,
    inferredEdges: inferredEdges.length,
    totalEdges: confirmedEdges.length + inferredEdges.length,
    resilienceScore,
    spofCount,
    biaProcesses: biaProcessCount,
    risksDetected,
    organizationProfileConfigured: profileConfigured,
    businessFlows: businessFlowSummary.flowsCreated,
    validatedBusinessFlows: businessFlowSummary.validatedFlows,
    unvalidatedBusinessFlows: businessFlowSummary.unvalidatedFlows,
    flowCoveragePercent: businessFlowSummary.coveragePercent,
    userOverrides: businessFlowSummary.userOverrides,
    spofs: [
      'payment-db (no replica, no multi-AZ)',
      'redis-main (single instance)',
      'erp-server (single on-premise server)',
      'api-gateway (single entry point)',
    ],
  };

  appLogger.info('Demo environment "ShopMax E-commerce" seeded successfully!');
  appLogger.info(`${summary.nodes} infrastructure nodes`);
  appLogger.info(`${summary.confirmedEdges} confirmed dependencies`);
  appLogger.info(`${summary.inferredEdges} inferred dependencies (to validate)`);
  appLogger.info(`Resilience score: ${resilienceScore}`);
  appLogger.info(`BIA processes: ${biaProcessCount}`);
  appLogger.info(`Auto-detected risks: ${risksDetected}`);
  appLogger.info(
    `Business flows: ${summary.businessFlows} (validated=${summary.validatedBusinessFlows}, ` +
      `coverage=${summary.flowCoveragePercent}%)`,
  );

  return summary;
}

