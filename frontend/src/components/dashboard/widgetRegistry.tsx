import type { ComponentType } from 'react';
import { BudgetDrWidget } from './widgets/BudgetDrWidget';
import { ComplianceWidget } from './widgets/ComplianceWidget';
import { CostByStrategyWidget } from './widgets/CostByStrategyWidget';
import { DriftsDetectedWidget } from './widgets/DriftsDetectedWidget';
import { LastScansWidget } from './widgets/LastScansWidget';
import { RecommendationsStatusWidget } from './widgets/RecommendationsStatusWidget';
import { ResilienceScoreWidget } from './widgets/ResilienceScoreWidget';
import { RoiGlobalWidget } from './widgets/RoiGlobalWidget';
import { RtoVsTargetWidget } from './widgets/RtoVsTargetWidget';
import { ServicesByProviderWidget } from './widgets/ServicesByProviderWidget';
import { ServicesByTierWidget } from './widgets/ServicesByTierWidget';
import { SpofCountWidget } from './widgets/SpofCountWidget';
import { TopCriticalServicesWidget } from './widgets/TopCriticalServicesWidget';

export type WidgetCategory = 'overview' | 'security' | 'compliance' | 'operations';

export interface DashboardLayoutItem {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  component: ComponentType;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  category: WidgetCategory;
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: 'resilience-score',
    title: 'Score de résilience',
    description: 'Jauge du score global de résilience',
    component: ResilienceScoreWidget,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'overview',
  },
  {
    id: 'spof-count',
    title: 'SPOF détectés',
    description: 'Nombre de SPOF et liste prioritaire',
    component: SpofCountWidget,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'security',
  },
  {
    id: 'budget-dr',
    title: 'Budget DR',
    description: 'Progression coût DR vs budget',
    component: BudgetDrWidget,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'overview',
  },
  {
    id: 'top-critical-services',
    title: 'Services critiques',
    description: 'Top services par criticité BIA',
    component: TopCriticalServicesWidget,
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 3 },
    category: 'operations',
  },
  {
    id: 'recommendations-status',
    title: 'Recommandations',
    description: 'Répartition validées/rejetées/en attente',
    component: RecommendationsStatusWidget,
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 3 },
    category: 'overview',
  },
  {
    id: 'compliance-iso22301',
    title: 'Conformité ISO 22301',
    description: 'Score conformité ISO 22301',
    component: () => <ComplianceWidget framework="iso22301" />,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'compliance',
  },
  {
    id: 'compliance-nis2',
    title: 'Conformité NIS 2',
    description: 'Score conformité NIS 2',
    component: () => <ComplianceWidget framework="nis2" />,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'compliance',
  },
  {
    id: 'last-scans',
    title: 'Derniers scans',
    description: 'Historique des derniers scans et drifts',
    component: LastScansWidget,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'operations',
  },
  {
    id: 'drifts-detected',
    title: 'Dérives détectées',
    description: 'Nombre de drifts ouverts',
    component: DriftsDetectedWidget,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'operations',
  },
  {
    id: 'cost-dr-by-strategy',
    title: 'Coûts DR par stratégie',
    description: 'Répartition des coûts DR par stratégie',
    component: CostByStrategyWidget,
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 4, h: 2 },
    category: 'overview',
  },
  {
    id: 'roi-global',
    title: 'ROI global',
    description: 'Indicateur ROI consolidé',
    component: RoiGlobalWidget,
    defaultSize: { w: 4, h: 2 },
    minSize: { w: 3, h: 2 },
    category: 'overview',
  },
  {
    id: 'services-by-provider',
    title: 'Services par provider',
    description: 'Répartition des nœuds par cloud provider',
    component: ServicesByProviderWidget,
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 4, h: 2 },
    category: 'operations',
  },
  {
    id: 'services-by-tier',
    title: 'Services par tier',
    description: 'Distribution des services par tier BIA',
    component: ServicesByTierWidget,
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 4, h: 2 },
    category: 'operations',
  },
  {
    id: 'rto-vs-target',
    title: 'RTO moyen vs cible',
    description: 'Comparaison RTO cible et effectif',
    component: RtoVsTargetWidget,
    defaultSize: { w: 6, h: 3 },
    minSize: { w: 4, h: 3 },
    category: 'operations',
  },
];

export const WIDGET_REGISTRY_BY_ID = new Map(WIDGET_REGISTRY.map((widget) => [widget.id, widget]));
export const KNOWN_WIDGET_IDS = new Set(WIDGET_REGISTRY.map((widget) => widget.id));

export const DEFAULT_LAYOUT: DashboardLayoutItem[] = [
  { widgetId: 'resilience-score', x: 0, y: 0, w: 4, h: 2 },
  { widgetId: 'spof-count', x: 4, y: 0, w: 4, h: 2 },
  { widgetId: 'budget-dr', x: 8, y: 0, w: 4, h: 2 },
  { widgetId: 'top-critical-services', x: 0, y: 2, w: 6, h: 3 },
  { widgetId: 'recommendations-status', x: 6, y: 2, w: 6, h: 3 },
  { widgetId: 'compliance-iso22301', x: 0, y: 5, w: 4, h: 2 },
  { widgetId: 'compliance-nis2', x: 4, y: 5, w: 4, h: 2 },
  { widgetId: 'last-scans', x: 8, y: 5, w: 4, h: 2 },
];

function toInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeLayout(layout: unknown): DashboardLayoutItem[] {
  if (!Array.isArray(layout)) return [];

  const seen = new Set<string>();
  const sanitized: DashboardLayoutItem[] = [];

  for (const item of layout) {
    if (!isRecord(item)) continue;
    if (typeof item.widgetId !== 'string') continue;
    if (!KNOWN_WIDGET_IDS.has(item.widgetId)) continue;
    if (seen.has(item.widgetId)) continue;

    const x = toInteger(item.x);
    const y = toInteger(item.y);
    const w = toInteger(item.w);
    const h = toInteger(item.h);
    if (x == null || y == null || w == null || h == null) continue;
    if (x < 0 || y < 0) continue;
    if (w < 1 || w > 12) continue;
    if (h < 1 || h > 10) continue;

    seen.add(item.widgetId);
    sanitized.push({ widgetId: item.widgetId, x, y, w, h });
  }

  return sanitized;
}
