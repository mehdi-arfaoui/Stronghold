export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-danger/20 bg-danger-soft p-8 text-center">
      <div className="mb-2 text-lg font-medium text-danger-foreground">Something went wrong</div>
      <div className="mb-4 max-w-xl text-sm text-muted-foreground">{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary px-4 py-2"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
