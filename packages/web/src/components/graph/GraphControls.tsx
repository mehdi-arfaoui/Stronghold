import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

const CONTROL_BUTTON_CLASS = 'btn-secondary-tight';

export function GraphControls({
  availableTypes,
  selectedTypes,
  onToggleType,
  onClearTypes,
  expandAll,
  onToggleExpandAll,
  onZoomIn,
  onZoomOut,
  onFitView,
}: {
  readonly availableTypes: readonly string[];
  readonly selectedTypes: ReadonlySet<string>;
  readonly onToggleType: (type: string) => void;
  readonly onClearTypes: () => void;
  readonly expandAll: boolean;
  readonly onToggleExpandAll: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onFitView: () => void;
}): JSX.Element {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isFilterOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!filterRef.current?.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsFilterOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFilterOpen]);

  return (
    <section className="panel relative z-20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onZoomIn} className={CONTROL_BUTTON_CLASS}>
          Zoom in
        </button>
        <button type="button" onClick={onZoomOut} className={CONTROL_BUTTON_CLASS}>
          Zoom out
        </button>
        <button type="button" onClick={onFitView} className={CONTROL_BUTTON_CLASS}>
          Fit to view
        </button>
        <button
          type="button"
          onClick={onToggleExpandAll}
          className={expandAll ? 'rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground' : CONTROL_BUTTON_CLASS}
        >
          {expandAll ? 'Collapse groups' : 'Expand all'}
        </button>
        <div ref={filterRef} className="relative">
          <button
            type="button"
            aria-expanded={isFilterOpen}
            aria-haspopup="dialog"
            onClick={() => setIsFilterOpen((current) => !current)}
            className={`${CONTROL_BUTTON_CLASS} inline-flex items-center gap-2`}
          >
            <span>Service filters ({selectedTypes.size || 'all'})</span>
            <ChevronDown className={`h-4 w-4 transition-transform duration-150 ${isFilterOpen ? 'rotate-180' : ''}`} />
          </button>
          {isFilterOpen ? (
            <div
              role="dialog"
              aria-label="Filter visible services"
              className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-4rem)] rounded-2xl border border-border bg-overlay/95 p-4 shadow-panel backdrop-blur-md"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Visible services</p>
                {selectedTypes.size > 0 ? (
                  <button
                    type="button"
                    onClick={onClearTypes}
                    className="text-xs font-medium uppercase tracking-[0.16em] text-accent-soft-foreground transition-colors duration-150 hover:text-accent"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
                <button
                  type="button"
                  onClick={onClearTypes}
                  className="btn-secondary-tight w-full text-left"
                >
                  Show all services
                </button>
                {availableTypes.map((type) => {
                  const isChecked = selectedTypes.size === 0 || selectedTypes.has(type);
                  return (
                    <label
                      key={type}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150',
                        isChecked
                          ? 'bg-accent-soft text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        style={{ accentColor: 'hsl(var(--accent))' }}
                        checked={isChecked}
                        onChange={() => onToggleType(type)}
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{type}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
