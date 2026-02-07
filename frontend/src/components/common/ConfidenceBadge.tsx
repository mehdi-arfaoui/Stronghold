import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ConfidenceBadgeProps {
  confidence: number;
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const level = confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low';
  const label = level === 'high' ? 'Fiable' : level === 'medium' ? 'Probable' : 'Incertain';

  return (
    <Badge
      variant="outline"
      className={cn(
        level === 'high' && 'border-resilience-high text-resilience-high',
        level === 'medium' && 'border-resilience-medium text-resilience-medium',
        level === 'low' && 'border-resilience-low text-resilience-low',
        className
      )}
    >
      {label} ({Math.round(confidence * 100)}%)
    </Badge>
  );
}
