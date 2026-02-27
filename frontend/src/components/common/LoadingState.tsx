import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  variant?: 'spinner' | 'skeleton';
  message?: string;
  count?: number;
}

export function LoadingState({ variant = 'spinner', message, count = 3 }: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div className="space-y-4 p-4">
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border bg-card p-4">
            <Skeleton className="h-4 w-[220px]" />
            <Skeleton className="h-4 w-[180px]" />
            <Skeleton className="h-4 w-[140px]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
