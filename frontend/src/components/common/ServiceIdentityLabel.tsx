import { cn } from '@/lib/utils';

interface ServiceIdentityLabelProps {
  primary: string;
  secondary?: string | null;
  className?: string;
  secondaryClassName?: string;
}

export function ServiceIdentityLabel({
  primary,
  secondary,
  className,
  secondaryClassName,
}: ServiceIdentityLabelProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-medium">{primary}</div>
      {secondary ? (
        <div className={cn('truncate text-xs text-muted-foreground', secondaryClassName)}>
          {secondary}
        </div>
      ) : null}
    </div>
  );
}
