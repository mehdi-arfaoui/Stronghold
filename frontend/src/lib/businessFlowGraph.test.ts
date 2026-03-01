import { describe, expect, it } from 'vitest';
import { buildVisibleFlowNodeIds } from '@/lib/businessFlowGraph';
import type { InfraEdge } from '@/types/graph.types';

describe('buildVisibleFlowNodeIds', () => {
  it('keeps flow services and their direct dependencies visible', () => {
    const edges: InfraEdge[] = [
      { id: '1', source: 'api', target: 'db', type: 'DEPENDS_ON' },
      { id: '2', source: 'db', target: 'cache', type: 'DEPENDS_ON' },
      { id: '3', source: 'batch', target: 'queue', type: 'DEPENDS_ON' },
    ];

    const result = buildVisibleFlowNodeIds(['db'], edges);

    expect([...result].sort()).toEqual(['api', 'cache', 'db']);
  });
});
