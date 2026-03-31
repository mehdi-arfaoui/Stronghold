import type { DRPComponent, InfraNode, WeightedValidationResult } from '@stronghold-dr/core';

import { InfraDisclaimer } from '@/components/common/InfraDisclaimer';
import { getStatusColor } from '@/lib/utils';

const DETAIL_VALUE_CLASS = 'min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

function primitiveMetadataEntries(node: InfraNode): Array<[string, string]> {
  return Object.entries(node.metadata)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 8)
    .map(([key, value]) => [key, String(value)]);
}

function DependencyList({
  label,
  nodes,
}: {
  readonly label: string;
  readonly nodes: readonly InfraNode[];
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <span className="text-subtle-foreground">{label}</span>
      {nodes.length === 0 ? (
        <span className="text-muted-foreground">None</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {nodes.map((item) => (
            <span
              key={item.id}
              className="max-w-full rounded-full border border-border bg-elevated px-3 py-1 text-xs text-foreground [overflow-wrap:anywhere]"
            >
              {item.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function NodeDetails({
  node,
  incoming,
  outgoing,
  results,
  rtoComponent,
  onViewInReport,
}: {
  readonly node: InfraNode | null;
  readonly incoming: readonly InfraNode[];
  readonly outgoing: readonly InfraNode[];
  readonly results: readonly WeightedValidationResult[];
  readonly rtoComponent: DRPComponent | null;
  readonly onViewInReport: () => void;
}): JSX.Element {
  if (!node) {
    return (
      <aside className="panel min-w-0 p-6">
        <p className="text-sm text-muted-foreground">
          Select a node to inspect metadata, dependencies, validation outcomes, and RTO hints.
        </p>
      </aside>
    );
  }

  const metadataEntries = primitiveMetadataEntries(node);

  return (
    <aside className="panel flex h-full min-w-0 flex-col overflow-hidden p-6">
      <div className="mb-6 min-w-0">
        <p className="text-xs uppercase tracking-[0.22em] text-subtle-foreground">Node details</p>
        <h2 className="mt-2 break-words text-xl font-semibold text-foreground">{node.name}</h2>
        <p className={`mt-1 text-sm text-muted-foreground ${DETAIL_VALUE_CLASS}`}>
          {node.type} - {node.region ?? 'global'} - {node.availabilityZone ?? 'n/a'}
        </p>
      </div>

      <div className="grid min-w-0 gap-6">
        <section className="grid min-w-0 gap-3 text-sm text-foreground">
          <div className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)] items-start gap-3">
            <span className="text-subtle-foreground">Provider</span>
            <span className={DETAIL_VALUE_CLASS}>{node.provider}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)] items-start gap-3">
            <span className="text-subtle-foreground">Region</span>
            <span className={DETAIL_VALUE_CLASS}>{node.region ?? 'global'}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)] items-start gap-3">
            <span className="text-subtle-foreground">AZ</span>
            <span className={DETAIL_VALUE_CLASS}>{node.availabilityZone ?? 'n/a'}</span>
          </div>
        </section>

        <section className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Metadata</p>
          <div className="mt-3 grid min-w-0 gap-2 text-sm text-foreground">
            {metadataEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No primitive metadata available for this node.</p>
            ) : (
              metadataEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[minmax(0,112px)_minmax(0,1fr)] items-start gap-3 rounded-xl border border-border bg-elevated px-3 py-2"
                >
                  <span className="text-subtle-foreground">{key}</span>
                  <span className={`min-w-0 font-mono text-xs leading-5 text-foreground ${DETAIL_VALUE_CLASS}`}>
                    {value}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Dependencies</p>
          <div className="mt-3 grid min-w-0 gap-4 text-sm text-foreground">
            <DependencyList label="Incoming" nodes={incoming} />
            <DependencyList label="Outgoing" nodes={outgoing} />
          </div>
        </section>

        <section className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Validation</p>
          <div className="mt-3 space-y-2">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No validation entries found for this node.</p>
            ) : (
              results.slice(0, 6).map((result) => (
                <div
                  key={`${result.ruleId}-${result.nodeId}`}
                  className="min-w-0 rounded-xl border border-border bg-elevated p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className={`min-w-0 flex-1 text-sm text-foreground ${DETAIL_VALUE_CLASS}`}>
                      {result.message}
                    </p>
                    <span
                      className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white"
                      style={{ backgroundColor: getStatusColor(result.status) }}
                    >
                      {result.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-border bg-elevated p-4 text-sm text-foreground">
          <div className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)] items-start gap-3">
            <span className="text-muted-foreground">Estimated RTO</span>
            <span className={`justify-self-end text-right ${DETAIL_VALUE_CLASS}`}>
              {rtoComponent?.estimatedRTO ?? 'Not available'}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,96px)_minmax(0,1fr)] items-start gap-3">
            <span className="text-muted-foreground">Estimated RPO</span>
            <span className={`justify-self-end text-right ${DETAIL_VALUE_CLASS}`}>
              {rtoComponent?.estimatedRPO ?? 'Not available'}
            </span>
          </div>
        </section>
      </div>

      <button
        type="button"
        onClick={onViewInReport}
        className="btn-primary mt-6"
      >
        View in Report
      </button>
      <div className="mt-4">
        <InfraDisclaimer />
      </div>
    </aside>
  );
}
