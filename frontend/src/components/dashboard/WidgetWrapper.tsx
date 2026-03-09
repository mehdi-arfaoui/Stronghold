import { X } from 'lucide-react';
import { WIDGET_REGISTRY_BY_ID } from './widgetRegistry';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { Button } from '@/components/ui/button';

interface WidgetWrapperProps {
  widgetId: string;
  editing: boolean;
  onRemove: () => void;
}

export function WidgetWrapper({ widgetId, editing, onRemove }: WidgetWrapperProps) {
  const widget = WIDGET_REGISTRY_BY_ID.get(widgetId);
  if (!widget) return null;

  const Component = widget.component;

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="truncate text-sm font-medium">{widget.title}</span>
        {editing && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onRemove}
            aria-label={`Retirer ${widget.title}`}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <WidgetErrorBoundary>
          <Component />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
