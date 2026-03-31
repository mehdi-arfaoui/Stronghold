import { useMemo, useState } from 'react';

export function GraphSearch({
  nodes,
  onSelect,
}: {
  readonly nodes: readonly { readonly id: string; readonly label: string; readonly subtitle: string }[];
  readonly onSelect: (nodeId: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    return nodes
      .filter((node) => `${node.label} ${node.subtitle}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [nodes, query]);

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search node by name"
        className="input-field w-full"
      />
      {matches.length > 0 ? (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-border bg-overlay/95 p-2 shadow-panel">
          {matches.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                setQuery(node.label);
                onSelect(node.id);
              }}
              className="flex w-full items-start justify-between rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-muted"
            >
              <span className="text-sm text-foreground">{node.label}</span>
              <span className="text-xs text-subtle-foreground">{node.subtitle}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
