import type { EdgeProvenance, InfraNodeAttrs, ScanEdge } from '../../types/index.js';

export const GRAPH_OVERRIDES_VERSION = 1;
export const DEFAULT_GRAPH_OVERRIDES_PATH = '.stronghold/overrides.yml';

export interface GraphEdgeOverride {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly reason: string;
}

export interface GraphCriticalityOverride {
  readonly node: string;
  readonly score: number;
  readonly reason: string;
}

export interface GraphOverrides {
  readonly version: number;
  readonly add_edges: readonly GraphEdgeOverride[];
  readonly remove_edges: readonly GraphEdgeOverride[];
  readonly criticality_overrides: readonly GraphCriticalityOverride[];
}

export interface ApplyGraphOverridesWarning {
  readonly code:
    | 'missing_node'
    | 'missing_edge'
    | 'duplicate_edge'
    | 'missing_criticality_target';
  readonly message: string;
}

export interface ApplyGraphOverridesResult {
  readonly nodes: readonly InfraNodeAttrs[];
  readonly edges: readonly ScanEdge[];
  readonly warnings: readonly ApplyGraphOverridesWarning[];
}

export type GraphEdgeProvenance = EdgeProvenance;
