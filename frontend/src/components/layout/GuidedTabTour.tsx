import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getCredentialScopeKey } from '@/lib/credentialStorage';
import { useGuidedTourStore } from '@/stores/guidedTour.store';
import {
  buildGuidedTabStorageKey,
  type GuidedTabGuide,
  GUIDED_TAB_CONTENT_AREA_ID,
  resolveGuidedTab,
} from './guidedTabTour.config';

type PanelPosition = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  startPosition: PanelPosition;
};

const PANEL_MARGIN = 12;

function isInteractiveTarget(target: HTMLElement): boolean {
  return Boolean(target.closest('button, a, input, textarea, select, [role="button"]'));
}

function clampPanelPosition(position: PanelPosition, panel: HTMLElement | null): PanelPosition {
  const contentArea = document.getElementById(GUIDED_TAB_CONTENT_AREA_ID);
  if (!contentArea || !panel) return position;

  const minX = PANEL_MARGIN;
  const minY = PANEL_MARGIN;
  const maxX = Math.max(PANEL_MARGIN, contentArea.clientWidth - panel.offsetWidth - PANEL_MARGIN);
  const maxY = Math.max(PANEL_MARGIN, contentArea.clientHeight - panel.offsetHeight - PANEL_MARGIN);

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}

interface GuidedTabTourPanelProps {
  guide: GuidedTabGuide;
  onDismiss: () => void;
}

function GuidedTabTourPanel({ guide, onDismiss }: GuidedTabTourPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      const contentArea = document.getElementById(GUIDED_TAB_CONTENT_AREA_ID);
      if (!panel || !contentArea) return;

      setPosition(
        clampPanelPosition(
          {
            x: contentArea.clientWidth - panel.offsetWidth - PANEL_MARGIN,
            y: PANEL_MARGIN,
          },
          panel
        )
      );
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => {
        if (!current) return current;
        return clampPanelPosition(current, panelRef.current);
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !position) return;
    if (isInteractiveTarget(event.target as HTMLElement)) return;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startPosition: position,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startPointerX;
    const deltaY = event.clientY - dragState.startPointerY;

    setPosition(
      clampPanelPosition(
        {
          x: dragState.startPosition.x + deltaX,
          y: dragState.startPosition.y + deltaY,
        },
        panelRef.current
      )
    );
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  };

  const panelStyle: CSSProperties = position
    ? { left: position.x, top: position.y }
    : { right: PANEL_MARGIN, top: PANEL_MARGIN };

  return (
    <div className="pointer-events-none absolute inset-0 z-40" aria-live="polite">
      <div
        ref={panelRef}
        className={cn(
          'pointer-events-auto absolute w-[min(380px,calc(100%-1rem))] max-w-[380px] rounded-lg border bg-card text-card-foreground shadow-xl animate-in fade-in duration-200',
          isDragging && 'select-none'
        )}
        role="dialog"
        aria-label={`Guide ${guide.title}`}
        style={panelStyle}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-3 border-b px-4 py-3',
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
        >
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Guide</p>
            <h2 className="text-sm font-semibold">{guide.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onDismiss}
            aria-label="Fermer le guide"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[min(75vh,calc(100%-3.5rem))] space-y-4 overflow-y-auto p-4 text-sm">
          {guide.sections.map((section) => (
            <section key={section.heading} className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section.heading}
              </h3>
              <ul className="space-y-1.5">
                {section.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 leading-relaxed">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GuidedTabTour() {
  const location = useLocation();
  const tenantScope = getCredentialScopeKey();
  const openRequest = useGuidedTourStore((state) => state.openRequest);
  const guide = useMemo(() => resolveGuidedTab(location.pathname), [location.pathname]);
  const [lastClosedManualNonce, setLastClosedManualNonce] = useState<number | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState(0);

  if (!guide) return null;

  const storageKey = buildGuidedTabStorageKey(guide, tenantScope);
  const dismissed = localStorage.getItem(storageKey) === '1';
  const manualNonce = openRequest?.pathname === location.pathname ? openRequest.nonce : null;
  const openedManually = manualNonce != null && manualNonce !== lastClosedManualNonce;
  const shouldRender = !dismissed || openedManually;

  if (!shouldRender) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, '1');
    if (manualNonce != null) {
      setLastClosedManualNonce(manualNonce);
    }
    setDismissedVersion((current) => current + 1);
  };

  const panelInstanceKey = `${guide.id}:${manualNonce ?? 'auto'}:${dismissedVersion}`;

  return <GuidedTabTourPanel key={panelInstanceKey} guide={guide} onDismiss={handleDismiss} />;
}
