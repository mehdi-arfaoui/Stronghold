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
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
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
