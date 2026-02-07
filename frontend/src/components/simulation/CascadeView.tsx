import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CascadeStep } from '@/types/simulation.types';

interface CascadeViewProps {
  steps: CascadeStep[];
}

export function CascadeView({ steps }: CascadeViewProps) {
  if (steps.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cascade d&apos;impact</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative space-y-4">
          {/* Vertical line */}
          <div className="absolute left-4 top-0 h-full w-0.5 bg-border" />

          {steps.map((step) => (
            <div key={step.step} className="relative flex gap-4 pl-4">
              {/* Dot */}
              <div className="absolute left-[11px] top-1 h-3 w-3 rounded-full border-2 border-severity-critical bg-card" />

              <div className="ml-6">
                <p className="text-sm font-semibold">Etape {step.step}</p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {step.nodesAffected.length} noeud(s) impacte(s)
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
