import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Step {
  label: string;
  completed: boolean;
  active: boolean;
}

interface StepIndicatorProps {
  steps: Step[];
  className?: string;
}

export function StepIndicator({ steps, className }: StepIndicatorProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
              step.completed && 'bg-primary text-primary-foreground',
              step.active && !step.completed && 'border-2 border-primary text-primary',
              !step.completed && !step.active && 'border-2 border-muted-foreground/30 text-muted-foreground'
            )}
          >
            {step.completed ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          <span
            className={cn(
              'text-sm',
              step.active ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div className={cn('h-px w-8', step.completed ? 'bg-primary' : 'bg-muted-foreground/30')} />
          )}
        </div>
      ))}
    </div>
  );
}
