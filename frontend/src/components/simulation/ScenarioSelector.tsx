import { Globe, Lock, Database, Unplug, Globe2, Radio, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SCENARIO_TYPES } from '@/lib/constants';
import type { ScenarioType } from '@/types/simulation.types';

const ICON_MAP: Record<string, LucideIcon> = {
  Globe, Lock, Database, Unplug, Globe2, Radio, Target,
};

interface ScenarioSelectorProps {
  onSelect: (type: ScenarioType) => void;
  selectedType?: ScenarioType;
}

export function ScenarioSelector({ onSelect, selectedType }: ScenarioSelectorProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {SCENARIO_TYPES.map((scenario) => {
        const Icon = ICON_MAP[scenario.icon] || Target;
        const isSelected = selectedType === scenario.id;

        return (
          <Card
            key={scenario.id}
            className={cn(
              'cursor-pointer transition-all hover:shadow-md',
              isSelected && 'ring-2 ring-primary'
            )}
            onClick={() => onSelect(scenario.id as ScenarioType)}
          >
            <CardContent className="p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">{scenario.label}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{scenario.description}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => onSelect(scenario.id as ScenarioType)}>
                Configurer
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
