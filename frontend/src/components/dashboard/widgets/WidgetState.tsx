import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function WidgetLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function WidgetFetchError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <AlertCircle className="h-5 w-5" />
      <span className="text-xs">Données indisponibles</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}
