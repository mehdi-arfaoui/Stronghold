import { MultiDirectedGraph } from 'graphology';

import type { GraphInstance } from '../graph/graph-instance.js';
import type { AccountScanResult, Finding, MultiAccountSummary } from './types.js';

type GraphRecord = Record<string, unknown>;

/**
 * Merge N graphes single-account en un graphe unifié.
 */
export class ScanResultMerger {
  public merge(
    results: readonly AccountScanResult[],
    options?: {
      readonly onAfterMerge?: (result: {
        readonly mergedGraph: GraphInstance;
        readonly mergedFindings: readonly Finding[];
        readonly summary: MultiAccountSummary;
        readonly accountResults: readonly AccountScanResult[];
      }) => void;
    },
  ): {
    mergedGraph: GraphInstance;
    mergedFindings: readonly Finding[];
    summary: MultiAccountSummary;
  } {
    const mergedGraph = new MultiDirectedGraph<GraphRecord, GraphRecord>();
    const resourcesByAccount = new Map<string, number>();
    const findingsByAccount = new Map<string, number>();
    const mergedFindings: Finding[] = [];

    for (const result of results) {
      resourcesByAccount.set(result.account.accountId, result.resources.length);
      findingsByAccount.set(result.account.accountId, result.findings.length);
      mergedFindings.push(...result.findings);

      result.graph.forEachNode((nodeId, attrs) => {
        if (mergedGraph.hasNode(nodeId)) {
          process.emitWarning(
            `Duplicate ARN detected during multi-account merge: ${nodeId}. Keeping the first node.`,
          );
          return;
        }

        mergedGraph.addNode(nodeId, {
          ...attrs,
          accountId:
            typeof attrs.accountId === 'string' && attrs.accountId.length > 0
              ? attrs.accountId
              : result.account.accountId,
        });
      });

      result.graph.forEachEdge((edgeKey, attrs, source, target) => {
        if (!mergedGraph.hasNode(source) || !mergedGraph.hasNode(target)) {
          return;
        }

        const type =
          typeof attrs.type === 'string' && attrs.type.length > 0
            ? attrs.type
            : 'DEPENDS_ON';
        const mergedEdgeKey = `${source}->${target}:${type}:${String(edgeKey)}`;
        if (mergedGraph.hasEdge(mergedEdgeKey)) {
          return;
        }

        mergedGraph.addEdgeWithKey(mergedEdgeKey, source, target, { ...attrs });
      });
    }

    const summary: MultiAccountSummary = {
      totalAccounts: results.length,
      successfulAccounts: results.length,
      failedAccounts: 0,
      totalResources: sumMapValues(resourcesByAccount),
      resourcesByAccount,
      totalFindings: sumMapValues(findingsByAccount),
      findingsByAccount,
      crossAccountEdges: 0,
    };
    const merged = {
      mergedGraph: mergedGraph as unknown as GraphInstance,
      mergedFindings,
      summary,
    };

    options?.onAfterMerge?.({
      ...merged,
      accountResults: results,
    });

    return merged;
  }
}

function sumMapValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of values.values()) {
    total += value;
  }
  return total;
}
