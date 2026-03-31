export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-muted ${className ?? 'h-4 w-full'}`} />;
}

export function CardSkeleton(): JSX.Element {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-5 shadow-panel">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}
