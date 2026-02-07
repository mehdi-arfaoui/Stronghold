import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Severity } from '@/types/common.types';

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

const LABELS: Record<Severity, string> = {
  critical: 'Critique',
  high: 'Eleve',
  medium: 'Moyen',
  low: 'Faible',
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        severity === 'critical' && 'border-severity-critical bg-severity-critical/10 text-severity-critical',
        severity === 'high' && 'border-severity-high bg-severity-high/10 text-severity-high',
        severity === 'medium' && 'border-severity-medium bg-severity-medium/10 text-severity-medium',
        severity === 'low' && 'border-severity-low bg-severity-low/10 text-severity-low',
        className
      )}
    >
      {LABELS[severity]}
    </Badge>
  );
}
