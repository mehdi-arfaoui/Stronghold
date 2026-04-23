import type { CrossAccountEdge } from '../cross-account/index.js';
import type { Service } from '../services/index.js';
import type { WeightedValidationResult } from '../validation/index.js';
import type { GraphInstance } from './graph-instance.js';

export interface RenderGraphOptions {
  readonly graph: GraphInstance;
  readonly crossAccountEdges: readonly CrossAccountEdge[];
  readonly findings?: readonly WeightedValidationResult[];
  readonly services?: readonly Service[];
  readonly title?: string;
}

export interface RenderedGraphNode {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly accountId: string | null;
  readonly region: string | null;
  readonly service: string | null;
  readonly severity: WeightedValidationResult['severity'] | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly x: number;
  readonly y: number;
}

export interface RenderedGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly kind: 'intra-account' | 'cross-account';
  readonly severity: 'critical' | 'degraded' | 'informational' | null;
  readonly label: string;
  readonly metadata: Readonly<Record<string, unknown>> | null;
}
