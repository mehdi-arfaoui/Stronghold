import {
  Activity,
  ClipboardList,
  LayoutDashboard,
  Radar,
  RefreshCcw,
  type LucideIcon,
} from 'lucide-react';

export const DR_CATEGORY_COLORS: Record<string, string> = {
  backup: '#3b82f6',
  redundancy: '#8b5cf6',
  failover: '#f59e0b',
  detection: '#ef4444',
  recovery: '#10b981',
  replication: '#06b6d4',
};

export const GRADE_COLORS: Record<string, string> = {
  A: '#10b981',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#f97316',
  F: '#ef4444',
};

export const STATUS_COLORS: Record<string, string> = {
  pass: '#10b981',
  fail: '#ef4444',
  warn: '#f59e0b',
  skip: '#9ca3af',
  error: '#ef4444',
};

export const STATUS_ORDER = ['fail', 'error', 'warn', 'pass', 'skip'] as const;

export const AWS_SERVICE_OPTIONS = [
  'ec2',
  'rds',
  'aurora',
  's3',
  'route53',
  'lambda',
  'dynamodb',
  'elasticache',
  'elb',
  'eks',
  'efs',
  'sqs',
  'sns',
  'backup',
  'cloudwatch',
] as const;

export interface NavigationItem {
  readonly label: string;
  readonly path: string;
  readonly icon: LucideIcon;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Scan', path: '/scan', icon: Radar },
  { label: 'Report', path: '/report', icon: Activity },
  { label: 'Graph', path: '/graph', icon: RefreshCcw },
  { label: 'DR Plan', path: '/drp', icon: ClipboardList },
  { label: 'Drift', path: '/drift', icon: Activity },
];

export const PAGE_TITLES: Record<string, string> = {
  '/': 'Disaster Recovery Dashboard',
  '/scan': 'Run an infrastructure scan',
  '/report': 'Validation report',
  '/graph': 'Dependency graph',
  '/drp': 'Recovery plan',
  '/drift': 'Drift history',
};
