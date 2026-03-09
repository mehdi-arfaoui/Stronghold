import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { WIDGET_REGISTRY } from './widgetRegistry';

interface WidgetSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeWidgetIds: Set<string>;
  onToggleWidget: (widgetId: string, enabled: boolean) => void;
}

export function WidgetSelector({
  open,
  onOpenChange,
  activeWidgetIds,
  onToggleWidget,
}: WidgetSelectorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ajouter ou retirer des widgets</DialogTitle>
          <DialogDescription>
            Activez les indicateurs à afficher sur votre tableau de bord.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {WIDGET_REGISTRY.map((widget) => {
            const enabled = activeWidgetIds.has(widget.id);
            return (
              <label
                key={widget.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{widget.title}</p>
                  <p className="text-xs text-muted-foreground">{widget.description}</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) => onToggleWidget(widget.id, checked)}
                  aria-label={`Activer ${widget.title}`}
                />
              </label>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
