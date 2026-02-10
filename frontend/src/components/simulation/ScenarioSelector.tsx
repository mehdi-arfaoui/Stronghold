import { useMemo, useState } from 'react';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ScenarioTemplate } from '@/types/simulation.types';
import { cn } from '@/lib/utils';

interface ScenarioSelectorProps {
  templates: ScenarioTemplate[];
  isLoading: boolean;
  isLaunching: boolean;
  onLaunch: (template: ScenarioTemplate, params: Record<string, unknown>) => void;
}

const CATEGORIES: Array<{ key: 'all' | ScenarioTemplate['category']; label: string }> = [
  { key: 'all', label: 'Toutes catégories' },
  { key: 'cyber', label: 'Cyber' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'natural', label: 'Naturel' },
  { key: 'human', label: 'Humain' },
];

export function ScenarioSelector({ templates, isLoading, isLaunching, onLaunch }: ScenarioSelectorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ScenarioTemplate['category']>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | ScenarioTemplate['severity']>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [paramsByScenario, setParamsByScenario] = useState<Record<string, Record<string, unknown>>>({});

  const tags = useMemo(() => [...new Set(templates.flatMap((t) => t.tags ?? []))].sort(), [templates]);
  const filtered = useMemo(() => templates.filter((template) => {
    const categoryOk = categoryFilter === 'all' || template.category === categoryFilter;
    const severityOk = severityFilter === 'all' || template.severity === severityFilter;
    const tagOk = !tagFilter || (template.tags ?? []).includes(tagFilter);
    return categoryOk && severityOk && tagOk;
  }), [templates, categoryFilter, severityFilter, tagFilter]);

  const selectedTemplate = useMemo(
    () => filtered.find((template) => template.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const effectiveParams = selectedTemplate
    ? (paramsByScenario[selectedTemplate.id] ?? Object.fromEntries((selectedTemplate.configurableParams ?? []).map((param) => [param.key, param.default])))
    : {};

  const setParam = (scenarioId: string, key: string, value: unknown) => {
    setParamsByScenario((prev) => ({
      ...prev,
      [scenarioId]: {
        ...(prev[scenarioId] ?? {}),
        [key]: value,
      },
    }));
  };

  const getIcon = (iconName: string): LucideIcon => {
    const key = iconName as keyof typeof Icons;
    const icon = Icons[key] as unknown as LucideIcon;
    return icon ?? Icons.ShieldAlert;
  };

  if (isLoading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Chargement de la bibliothèque de scénarios...</CardContent></Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Bibliothèque de scénarios</CardTitle>
          <div className="grid gap-2 md:grid-cols-3">
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as typeof categoryFilter)}>
              <SelectTrigger><SelectValue placeholder="Catégorie" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((cat) => <SelectItem key={cat.key} value={cat.key}>{cat.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as typeof severityFilter)}>
              <SelectTrigger><SelectValue placeholder="Sévérité" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes sévérités</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tagFilter || 'all'} onValueChange={(v) => setTagFilter(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous tags</SelectItem>
                {tags.map((tag) => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((scenario) => {
              const Icon = getIcon(scenario.icon ?? 'ShieldAlert');
              const isSelected = selectedTemplate?.id === scenario.id;
              return (
                <button
                  type="button"
                  key={scenario.id}
                  onClick={() => setSelectedId(scenario.id)}
                  className={cn('rounded-lg border p-4 text-left transition hover:border-primary', isSelected && 'border-primary ring-1 ring-primary')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="font-medium">{scenario.name}</span>
                    </div>
                    <Badge variant={scenario.severity === 'critical' ? 'destructive' : 'secondary'}>{scenario.severity}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{scenario.description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Détail et lancement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedTemplate && <p className="text-sm text-muted-foreground">Sélectionnez un scénario pour afficher les détails.</p>}
          {selectedTemplate && (
            <>
              <div>
                <p className="font-medium">{selectedTemplate.name}</p>
                <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                {selectedTemplate.realWorldExample && (
                  <p className="mt-1 text-xs text-muted-foreground">Exemple réel : {selectedTemplate.realWorldExample}</p>
                )}
              </div>

              <div className="space-y-2">
                {(selectedTemplate.configurableParams ?? []).map((param) => {
                  const value = effectiveParams[param.key] ?? param.default;
                  return (
                    <div key={param.key} className="space-y-1">
                      <Label>{param.label}</Label>
                      {param.type === 'select' && (
                        <Select value={String(value ?? '')} onValueChange={(val) => setParam(selectedTemplate.id, param.key, val)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(param.options ?? []).map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      {param.type === 'number' && (
                        <Input type="number" value={Number(value ?? 0)} onChange={(e) => setParam(selectedTemplate.id, param.key, Number(e.target.value ?? 0))} />
                      )}
                      {param.type === 'boolean' && (
                        <Select value={String(Boolean(value ?? false))} onValueChange={(val) => setParam(selectedTemplate.id, param.key, val === 'true')}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Oui</SelectItem>
                            <SelectItem value="false">Non</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  );
                })}
              </div>

              <Button
                className="w-full"
                variant={selectedTemplate.severity === 'critical' ? 'destructive' : 'default'}
                onClick={() => onLaunch(selectedTemplate, effectiveParams)}
                disabled={isLaunching}
              >
                {isLaunching ? 'Lancement...' : `Lancer (${selectedTemplate.severity.toUpperCase()})`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
