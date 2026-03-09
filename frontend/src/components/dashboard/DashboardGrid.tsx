import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Edit3, Loader2, Plus } from 'lucide-react';
import ReactGridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { dashboardApi, type DashboardLayoutItem as ApiDashboardLayoutItem } from '@/api/dashboard.api';
import { Button } from '@/components/ui/button';
import { WidgetSelector } from './WidgetSelector';
import { WidgetWrapper } from './WidgetWrapper';
import {
  DEFAULT_LAYOUT,
  WIDGET_REGISTRY_BY_ID,
  sanitizeLayout,
  type DashboardLayoutItem,
} from './widgetRegistry';

type GridItemLayout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

type GridLayouts = Record<string, GridItemLayout[]>;

const gridLayoutLibrary = ReactGridLayout as unknown as {
  Responsive: ComponentType<any>;
  WidthProvider: (component: ComponentType<any>) => ComponentType<any>;
};

const ResponsiveGridLayout = gridLayoutLibrary.WidthProvider(gridLayoutLibrary.Responsive);

function toGridLayout(layout: DashboardLayoutItem[]): GridItemLayout[] {
  return layout
    .map((item) => {
      const definition = WIDGET_REGISTRY_BY_ID.get(item.widgetId);
      return {
        i: item.widgetId,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: definition?.minSize?.w,
        minH: definition?.minSize?.h,
      } as GridItemLayout;
    })
    .sort((left, right) => (left.y - right.y) || (left.x - right.x));
}

function fromGridLayout(layout: GridItemLayout[]): DashboardLayoutItem[] {
  return layout.map((item) => ({
    widgetId: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  }));
}

function normalizeServerLayout(rawLayout: ApiDashboardLayoutItem[] | unknown): DashboardLayoutItem[] {
  const cleaned = sanitizeLayout(rawLayout);
  if (!Array.isArray(rawLayout)) return DEFAULT_LAYOUT;
  return cleaned;
}

function getNextY(layout: DashboardLayoutItem[]) {
  return layout.reduce((maxY, item) => Math.max(maxY, item.y + item.h), 0);
}

export function DashboardGrid() {
  const [layout, setLayout] = useState<DashboardLayoutItem[]>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [showWidgetSelector, setShowWidgetSelector] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const mountedRef = useRef(true);
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimeoutRef.current != null) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await dashboardApi.getConfig();
        if (cancelled) return;
        setLayout(normalizeServerLayout(response.data));
      } catch {
        if (cancelled) return;
        setLayout(DEFAULT_LAYOUT);
      } finally {
        if (!cancelled) {
          setIsLoadingConfig(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistLayout = useCallback((nextLayout: DashboardLayoutItem[], immediate = false) => {
    if (saveTimeoutRef.current != null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const save = async () => {
      setIsSaving(true);
      try {
        await dashboardApi.saveConfig(nextLayout);
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    };

    if (immediate) {
      void save();
      return;
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      void save();
    }, 1000);
  }, []);

  const handleLayoutChange = useCallback(
    (_currentLayout: GridItemLayout[], allLayouts: GridLayouts) => {
      if (!editing) return;

      const rawLayout = allLayouts.lg ?? [];
      const nextLayout = sanitizeLayout(fromGridLayout(rawLayout));
      setLayout(nextLayout);
      persistLayout(nextLayout);
    },
    [editing, persistLayout],
  );

  const activeWidgetIds = useMemo(() => new Set(layout.map((item) => item.widgetId)), [layout]);

  const addWidget = useCallback(
    (widgetId: string) => {
      if (activeWidgetIds.has(widgetId)) return;

      const definition = WIDGET_REGISTRY_BY_ID.get(widgetId);
      if (!definition) return;

      const nextLayout = sanitizeLayout([
        ...layout,
        {
          widgetId,
          x: 0,
          y: getNextY(layout),
          w: definition.defaultSize.w,
          h: definition.defaultSize.h,
        },
      ]);
      setLayout(nextLayout);
      persistLayout(nextLayout, true);
    },
    [activeWidgetIds, layout, persistLayout],
  );

  const removeWidget = useCallback(
    (widgetId: string) => {
      const nextLayout = layout.filter((item) => item.widgetId !== widgetId);
      setLayout(nextLayout);
      persistLayout(nextLayout, true);
    },
    [layout, persistLayout],
  );

  const handleToggleWidget = useCallback(
    (widgetId: string, enabled: boolean) => {
      if (enabled) {
        addWidget(widgetId);
      } else {
        removeWidget(widgetId);
      }
    },
    [addWidget, removeWidget],
  );

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="text-xs text-muted-foreground">
            Glissez-deposez les widgets en mode personnalisation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSaving && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sauvegarde...
            </span>
          )}
          <Button type="button" variant={editing ? 'default' : 'outline'} onClick={() => setEditing((value) => !value)}>
            <Edit3 className="mr-2 h-4 w-4" />
            {editing ? 'Terminer' : 'Personnaliser'}
          </Button>
          {editing && (
            <Button type="button" variant="outline" onClick={() => setShowWidgetSelector(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Ajouter un widget
            </Button>
          )}
        </div>
      </div>

      {layout.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">Aucun widget actif sur ce dashboard.</p>
          <Button type="button" className="mt-3" onClick={() => { setEditing(true); setShowWidgetSelector(true); }}>
            Ajouter un widget
          </Button>
        </div>
      ) : (
        <ResponsiveGridLayout
          className="layout"
          layouts={{ lg: toGridLayout(layout) }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 2 }}
          rowHeight={80}
          margin={[16, 16]}
          isDraggable={editing}
          isResizable={editing}
          compactType="vertical"
          onLayoutChange={handleLayoutChange}
          draggableCancel=".react-resizable-handle,button"
        >
          {layout.map((item) => (
            <div key={item.widgetId}>
              <WidgetWrapper widgetId={item.widgetId} editing={editing} onRemove={() => removeWidget(item.widgetId)} />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}

      <WidgetSelector
        open={showWidgetSelector}
        onOpenChange={setShowWidgetSelector}
        activeWidgetIds={activeWidgetIds}
        onToggleWidget={handleToggleWidget}
      />
    </div>
  );
}
