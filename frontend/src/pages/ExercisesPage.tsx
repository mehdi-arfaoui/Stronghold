import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OperationalRunbooksPanel } from '@/components/exercises/OperationalRunbooksPanel';
import { RemediationKanbanPanel } from '@/components/exercises/RemediationKanbanPanel';
import { PRAExercisesPanel } from '@/components/exercises/PRAExercisesPanel';

type OperationalTab = 'runbooks' | 'remediation' | 'exercises';

export function ExercisesPage() {
  const [tab, setTab] = useState<OperationalTab>('runbooks');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Plans & Exercices</h1>
        <p className="text-sm text-muted-foreground">
          Runbooks operationnels, suivi de remediation et exercices PRA avec boucle d'amelioration.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as OperationalTab)}>
        <TabsList>
          <TabsTrigger value="runbooks">Runbooks</TabsTrigger>
          <TabsTrigger value="remediation">Suivi Remediation</TabsTrigger>
          <TabsTrigger value="exercises">Exercices</TabsTrigger>
        </TabsList>

        <TabsContent value="runbooks">
          <OperationalRunbooksPanel />
        </TabsContent>

        <TabsContent value="remediation">
          <RemediationKanbanPanel />
        </TabsContent>

        <TabsContent value="exercises">
          <PRAExercisesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

