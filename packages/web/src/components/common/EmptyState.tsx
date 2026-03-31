export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong bg-card/80 p-12 text-center shadow-panel">
      <div className="mb-2 text-lg font-medium text-foreground">{title}</div>
      <div className="mb-4 max-w-xl text-sm text-muted-foreground">{description}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="btn-primary px-4 py-2"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
