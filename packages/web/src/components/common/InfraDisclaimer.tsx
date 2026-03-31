export function InfraDisclaimer(): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-full bg-muted/80 px-3 py-2 text-xs text-subtle-foreground">
      <span className="font-semibold text-accent-soft-foreground">Sensitive</span>
      <span>This view contains infrastructure metadata. Share responsibly.</span>
    </div>
  );
}
