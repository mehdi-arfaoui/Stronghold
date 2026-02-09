import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Users,
  Loader2,
  Plus,
  Trash2,
  BookOpen,
  Route,
  Zap,
  ArrowLeftRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { StepIndicator } from '@/components/layout/StepIndicator';
import { cn } from '@/lib/utils';
import { exercisesApi, type Exercise } from '@/api/exercises.api';

type ExerciseType = 'tabletop' | 'walkthrough' | 'simulation' | 'full';

interface Participant {
  name: string;
  email: string;
  role: 'coordinator' | 'actor' | 'observer' | 'evaluator';
}

interface KPI {
  name: string;
  target: string;
  unit: string;
}

interface WizardData {
  type: ExerciseType;
  scenario: string;
  customScenario: string;
  objective: string;
  participants: Participant[];
  systems: string[];
  scheduledDate: string;
  scheduledTime: string;
  duration: number;
  reminders: { email: boolean; webhook: boolean };
  instructions: string;
  kpis: KPI[];
}

const EXERCISE_TYPES: { value: ExerciseType; label: string; description: string; icon: typeof BookOpen }[] = [
  { value: 'tabletop', label: 'Exercice sur table', description: 'Discussion theorique du plan', icon: BookOpen },
  { value: 'walkthrough', label: 'Walkthrough', description: 'Parcours pas a pas des procedures', icon: Route },
  { value: 'simulation', label: 'Simulation technique', description: 'Test reel des procedures', icon: Zap },
  { value: 'full', label: 'Test de basculement', description: 'Bascule reelle vers le site de secours', icon: ArrowLeftRight },
];

const ROLE_LABELS: Record<string, string> = {
  coordinator: 'Coordinateur',
  actor: 'Acteur',
  observer: 'Observateur',
  evaluator: 'Evaluateur',
};

const DEFAULT_KPIS: KPI[] = [
  { name: 'Temps de detection', target: '15', unit: 'min' },
  { name: 'RTO respecte', target: '100', unit: '%' },
  { name: 'Communication initiale', target: '5', unit: 'min' },
];

const INITIAL_DATA: WizardData = {
  type: 'tabletop',
  scenario: '',
  customScenario: '',
  objective: '',
  participants: [],
  systems: [],
  scheduledDate: '',
  scheduledTime: '09:00',
  duration: 120,
  reminders: { email: true, webhook: false },
  instructions: '',
  kpis: [...DEFAULT_KPIS],
};

interface ExercisePlannerWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarios?: { id: string; name: string }[];
}

export function ExercisePlannerWizard({ open, onOpenChange, scenarios = [] }: ExercisePlannerWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [newParticipant, setNewParticipant] = useState<Participant>({ name: '', email: '', role: 'actor' });

  const totalSteps = 4;
  const steps = [
    { label: 'Type & Scenario', completed: step > 0, active: step === 0 },
    { label: 'Perimetre', completed: step > 1, active: step === 1 },
    { label: 'Planning', completed: step > 2, active: step === 2 },
    { label: 'Criteres & Recap', completed: step > 3, active: step === 3 },
  ];

  const createMutation = useMutation({
    mutationFn: (exercise: Partial<Exercise>) => exercisesApi.create(exercise),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exercises'] });
      toast.success('Exercice planifie avec succes', {
        description: `L'exercice "${data.objective || 'Nouvel exercice'}" a ete cree.`,
      });
      onOpenChange(false);
      resetWizard();
    },
    onError: () => {
      toast.error('Erreur lors de la creation de l\'exercice');
    },
  });

  const resetWizard = () => {
    setStep(0);
    setData(INITIAL_DATA);
  };

  const updateData = (partial: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  };

  const addParticipant = () => {
    if (!newParticipant.name || !newParticipant.email) return;
    updateData({ participants: [...data.participants, { ...newParticipant }] });
    setNewParticipant({ name: '', email: '', role: 'actor' });
  };

  const removeParticipant = (index: number) => {
    updateData({ participants: data.participants.filter((_, i) => i !== index) });
  };

  const addKPI = () => {
    updateData({ kpis: [...data.kpis, { name: '', target: '', unit: '' }] });
  };

  const updateKPI = (index: number, field: keyof KPI, value: string) => {
    const updated = [...data.kpis];
    updated[index] = { ...updated[index], [field]: value };
    updateData({ kpis: updated });
  };

  const removeKPI = (index: number) => {
    updateData({ kpis: data.kpis.filter((_, i) => i !== index) });
  };

  const canProceed = () => {
    switch (step) {
      case 0: return data.type && (data.scenario || data.customScenario);
      case 1: return true;
      case 2: return data.scheduledDate && data.scheduledTime;
      case 3: return true;
      default: return false;
    }
  };

  const handleSubmit = () => {
    const exercise: Partial<Exercise> = {
      name: data.objective || `Exercice ${EXERCISE_TYPES.find((t) => t.value === data.type)?.label}`,
      type: data.type,
      status: 'planned',
      scheduledDate: `${data.scheduledDate}T${data.scheduledTime}:00.000Z`,
      scenario: data.scenario || data.customScenario,
      participants: data.participants.map((p) => p.email),
    };
    createMutation.mutate(exercise);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-label="Planifier un exercice">
        <DialogHeader>
          <DialogTitle>Planifier un exercice PRA/PCA</DialogTitle>
          <DialogDescription>
            Configurez votre exercice en {totalSteps} etapes
          </DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <StepIndicator steps={steps} className="my-4" />

        {/* Step Content */}
        <div className="min-h-[300px] py-4">
          {/* Step 1: Type & Scenario */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <Label className="mb-3 block font-medium">Type d'exercice</Label>
                <div className="grid grid-cols-2 gap-3">
                  {EXERCISE_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => updateData({ type: type.value })}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-4 text-left transition-all duration-200',
                        data.type === type.value
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/50'
                      )}
                      aria-pressed={data.type === type.value}
                    >
                      <type.icon className={cn('h-5 w-5 mt-0.5 shrink-0', data.type === type.value ? 'text-primary' : 'text-muted-foreground')} />
                      <div>
                        <p className="font-medium text-sm">{type.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{type.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="mb-2 block font-medium">Scenario</Label>
                <Select value={data.scenario} onValueChange={(v) => updateData({ scenario: v, customScenario: '' })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selectionner un scenario..." />
                  </SelectTrigger>
                  <SelectContent>
                    {scenarios.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                    <SelectItem value="custom">Scenario personnalise</SelectItem>
                  </SelectContent>
                </Select>
                {data.scenario === 'custom' && (
                  <Input
                    className="mt-2"
                    placeholder="Decrivez votre scenario..."
                    value={data.customScenario}
                    onChange={(e) => updateData({ customScenario: e.target.value })}
                  />
                )}
              </div>

              <div>
                <Label className="mb-2 block font-medium">Objectif de l'exercice</Label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Decrivez l'objectif principal de cet exercice..."
                  value={data.objective}
                  onChange={(e) => updateData({ objective: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Step 2: Scope & Participants */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <Label className="mb-3 block font-medium">Participants</Label>

                {/* Add participant form */}
                <div className="flex gap-2 mb-3">
                  <Input
                    placeholder="Nom"
                    value={newParticipant.name}
                    onChange={(e) => setNewParticipant((p) => ({ ...p, name: e.target.value }))}
                    className="flex-1"
                  />
                  <Input
                    placeholder="Email"
                    type="email"
                    value={newParticipant.email}
                    onChange={(e) => setNewParticipant((p) => ({ ...p, email: e.target.value }))}
                    className="flex-1"
                  />
                  <Select value={newParticipant.role} onValueChange={(v) => setNewParticipant((p) => ({ ...p, role: v as Participant['role'] }))}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="icon" onClick={addParticipant} disabled={!newParticipant.name || !newParticipant.email} aria-label="Ajouter">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Participant list */}
                <div className="space-y-2">
                  {data.participants.map((p, i) => (
                    <div key={i} className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{ROLE_LABELS[p.role]}</Badge>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeParticipant(i)} aria-label="Supprimer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {data.participants.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Aucun participant ajoute.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Planning & Notifications */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-2 block font-medium">Date</Label>
                  <Input
                    type="date"
                    value={data.scheduledDate}
                    onChange={(e) => updateData({ scheduledDate: e.target.value })}
                    aria-label="Date de l'exercice"
                  />
                </div>
                <div>
                  <Label className="mb-2 block font-medium">Heure de debut</Label>
                  <Input
                    type="time"
                    value={data.scheduledTime}
                    onChange={(e) => updateData({ scheduledTime: e.target.value })}
                    aria-label="Heure de debut"
                  />
                </div>
              </div>

              <div>
                <Label className="mb-2 block font-medium">Duree estimee</Label>
                <Select value={String(data.duration)} onValueChange={(v) => updateData({ duration: Number(v) })}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">1 heure</SelectItem>
                    <SelectItem value="120">2 heures</SelectItem>
                    <SelectItem value="240">4 heures</SelectItem>
                    <SelectItem value="480">1 journee</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-3 block font-medium">Rappels automatiques</Label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.reminders.email}
                      onChange={(e) => updateData({ reminders: { ...data.reminders, email: e.target.checked } })}
                      className="rounded border-border"
                    />
                    Email (J-7, J-1, H-1)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.reminders.webhook}
                      onChange={(e) => updateData({ reminders: { ...data.reminders, webhook: e.target.checked } })}
                      className="rounded border-border"
                    />
                    Webhook
                  </label>
                </div>
              </div>

              <div>
                <Label className="mb-2 block font-medium">Instructions prealables</Label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Instructions envoyees aux participants avant l'exercice..."
                  value={data.instructions}
                  onChange={(e) => updateData({ instructions: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* Step 4: KPIs & Summary */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="font-medium">Criteres de succes (KPIs)</Label>
                  <Button variant="outline" size="sm" onClick={addKPI}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Ajouter
                  </Button>
                </div>
                <div className="space-y-2">
                  {data.kpis.map((kpi, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Nom du KPI"
                        value={kpi.name}
                        onChange={(e) => updateKPI(i, 'name', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="Cible"
                        value={kpi.target}
                        onChange={(e) => updateKPI(i, 'target', e.target.value)}
                        className="w-20"
                      />
                      <Input
                        placeholder="Unite"
                        value={kpi.unit}
                        onChange={(e) => updateKPI(i, 'unit', e.target.value)}
                        className="w-20"
                      />
                      <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeKPI(i)} aria-label="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="font-semibold text-sm">Recapitulatif</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Type</p>
                    <p className="font-medium">{EXERCISE_TYPES.find((t) => t.value === data.type)?.label}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Scenario</p>
                    <p className="font-medium">{data.scenario === 'custom' ? data.customScenario : scenarios.find((s) => s.id === data.scenario)?.name || 'Non defini'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-medium">{data.scheduledDate ? new Date(data.scheduledDate).toLocaleDateString('fr-FR') : 'Non definie'} a {data.scheduledTime}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Duree</p>
                    <p className="font-medium">{data.duration >= 60 ? `${data.duration / 60}h` : `${data.duration}min`}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Participants</p>
                    <p className="font-medium">{data.participants.length} personne(s)</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">KPIs</p>
                    <p className="font-medium">{data.kpis.filter((k) => k.name).length} critere(s)</p>
                  </div>
                </div>
                {data.objective && (
                  <div>
                    <p className="text-muted-foreground text-sm">Objectif</p>
                    <p className="text-sm">{data.objective}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => step > 0 ? setStep(step - 1) : onOpenChange(false)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            {step > 0 ? 'Precedent' : 'Annuler'}
          </Button>

          <span className="text-sm text-muted-foreground">
            Etape {step + 1}/{totalSteps}
          </span>

          {step < totalSteps - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()}>
              Suivant
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="mr-2 h-4 w-4" />
              )}
              Planifier l'exercice
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
