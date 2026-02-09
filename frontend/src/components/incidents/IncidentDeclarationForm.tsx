import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Server,
  Tag,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
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
import { cn } from '@/lib/utils';
import { incidentsApi, type Incident } from '@/api/incidents.api';
import { useGraph } from '@/hooks/useGraph';

type Severity = 'critical' | 'high' | 'medium' | 'low';
type Priority = 'P1' | 'P2' | 'P3' | 'P4';
type DetectionSource = 'monitoring' | 'user' | 'email' | 'servicenow' | 'manual';
type Category = 'infrastructure' | 'security' | 'network' | 'application' | 'data';

const SEVERITY_CONFIG: Record<Severity, { label: string; color: string }> = {
  critical: { label: 'Critique', color: 'bg-severity-critical text-white' },
  high: { label: 'Haut', color: 'bg-severity-high text-white' },
  medium: { label: 'Moyen', color: 'bg-severity-medium text-white' },
  low: { label: 'Bas', color: 'bg-severity-low text-white' },
};

const DETECTION_SOURCES: { value: DetectionSource; label: string }[] = [
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'user', label: 'Utilisateur' },
  { value: 'email', label: 'Email' },
  { value: 'servicenow', label: 'ServiceNow' },
  { value: 'manual', label: 'Manuel' },
];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'security', label: 'Securite' },
  { value: 'network', label: 'Reseau' },
  { value: 'application', label: 'Application' },
  { value: 'data', label: 'Donnees' },
];

interface IncidentFormData {
  title: string;
  description: string;
  detectedAt: string;
  source: DetectionSource;
  affectedNodes: string[];
  severity: Severity;
  category: Category;
  priority: Priority;
}

interface IncidentDeclarationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IncidentDeclarationForm({ open, onOpenChange }: IncidentDeclarationFormProps) {
  const queryClient = useQueryClient();
  const { allNodes } = useGraph();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['identification', 'impact', 'classification']));
  const [aiSuggested, setAiSuggested] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');

  const [formData, setFormData] = useState<IncidentFormData>({
    title: '',
    description: '',
    detectedAt: new Date().toISOString().slice(0, 16),
    source: 'manual',
    affectedNodes: [],
    severity: 'medium',
    category: 'infrastructure',
    priority: 'P3',
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Incident>) => incidentsApi.create(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      const id = response.data?.id || 'INC-XXXX';
      toast.success(`Incident ${id} declare`, {
        description: 'Plan de reponse active.',
        duration: 5000,
      });
      onOpenChange(false);
      resetForm();
    },
    onError: () => {
      toast.error('Erreur lors de la declaration de l\'incident');
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      detectedAt: new Date().toISOString().slice(0, 16),
      source: 'manual',
      affectedNodes: [],
      severity: 'medium',
      category: 'infrastructure',
      priority: 'P3',
    });
    setAiSuggested(false);
  };

  const updateForm = (partial: Partial<IncidentFormData>) => {
    setFormData((prev) => ({ ...prev, ...partial }));
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });
  };

  const toggleNode = (nodeId: string) => {
    setFormData((prev) => {
      const next = prev.affectedNodes.includes(nodeId)
        ? prev.affectedNodes.filter((id) => id !== nodeId)
        : [...prev.affectedNodes, nodeId];
      return { ...prev, affectedNodes: next };
    });
  };

  // AI-based severity suggestion
  const suggestSeverity = () => {
    const criticalNodes = formData.affectedNodes.filter((id) => {
      const node = allNodes.find((n) => n.id === id);
      return node?.type === 'DATABASE' || node?.type === 'LOAD_BALANCER';
    });

    let suggested: Severity = 'low';
    if (formData.affectedNodes.length >= 5 || criticalNodes.length >= 2) {
      suggested = 'critical';
    } else if (formData.affectedNodes.length >= 3 || criticalNodes.length >= 1) {
      suggested = 'high';
    } else if (formData.affectedNodes.length >= 1) {
      suggested = 'medium';
    }

    updateForm({ severity: suggested });
    setAiSuggested(true);
  };

  const filteredNodes = useMemo(() => {
    if (!nodeSearch) return allNodes.slice(0, 30);
    const search = nodeSearch.toLowerCase();
    return allNodes.filter(
      (n) => n.name.toLowerCase().includes(search) || n.type.toLowerCase().includes(search)
    ).slice(0, 30);
  }, [allNodes, nodeSearch]);

  const impactSummary = useMemo(() => {
    const affected = formData.affectedNodes.length;
    return `${affected} service${affected > 1 ? 's' : ''} impacte${affected > 1 ? 's' : ''}`;
  }, [formData.affectedNodes]);

  const canSubmit = formData.title.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;

    createMutation.mutate({
      title: formData.title,
      description: formData.description,
      severity: formData.severity,
      status: 'open',
      affectedNodes: formData.affectedNodes,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-label="Declarer un incident">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-severity-critical" />
            Declarer un incident
          </DialogTitle>
          <DialogDescription>
            Renseignez les informations pour declarer un nouvel incident
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Section 1: Identification */}
          <SectionAccordion
            title="Identification"
            icon={FileText}
            expanded={expandedSections.has('identification')}
            onToggle={() => toggleSection('identification')}
          >
            <div className="space-y-4">
              <div>
                <Label className="mb-1.5 block">Titre de l'incident *</Label>
                <Input
                  placeholder="Ex: Panne du service de base de donnees principal"
                  value={formData.title}
                  onChange={(e) => updateForm({ title: e.target.value })}
                  aria-required="true"
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Description</Label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[100px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Decrivez l'incident en detail..."
                  value={formData.description}
                  onChange={(e) => updateForm({ description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1.5 block">Date/heure de detection</Label>
                  <Input
                    type="datetime-local"
                    value={formData.detectedAt}
                    onChange={(e) => updateForm({ detectedAt: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block">Source de detection</Label>
                  <Select value={formData.source} onValueChange={(v) => updateForm({ source: v as DetectionSource })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DETECTION_SOURCES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </SectionAccordion>

          {/* Section 2: Impact */}
          <SectionAccordion
            title="Impact"
            icon={Server}
            expanded={expandedSections.has('impact')}
            onToggle={() => toggleSection('impact')}
            badge={impactSummary}
          >
            <div className="space-y-3">
              <Input
                placeholder="Rechercher un composant..."
                value={nodeSearch}
                onChange={(e) => setNodeSearch(e.target.value)}
                className="mb-2"
                aria-label="Rechercher"
              />

              <div className="max-h-[200px] overflow-y-auto rounded-md border p-2 space-y-1">
                {filteredNodes.map((node) => {
                  const isSelected = formData.affectedNodes.includes(node.id);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => toggleNode(node.id)}
                      className={cn(
                        'flex items-center justify-between w-full rounded-md px-3 py-2 text-sm text-left transition-colors',
                        isSelected
                          ? 'bg-severity-critical/10 border border-severity-critical/30'
                          : 'hover:bg-accent'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Server className={cn('h-3.5 w-3.5', isSelected ? 'text-severity-critical' : 'text-muted-foreground')} />
                        <span className="font-medium">{node.name}</span>
                        <span className="text-xs text-muted-foreground">{node.type}</span>
                      </div>
                      {isSelected && <Badge variant="outline" className="text-xs border-severity-critical text-severity-critical">Impacte</Badge>}
                    </button>
                  );
                })}
                {filteredNodes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Aucun composant trouve.</p>
                )}
              </div>

              {formData.affectedNodes.length > 0 && (
                <p className="text-sm font-medium text-severity-critical">
                  {impactSummary}
                </p>
              )}
            </div>
          </SectionAccordion>

          {/* Section 3: Classification */}
          <SectionAccordion
            title="Classification"
            icon={Tag}
            expanded={expandedSections.has('classification')}
            onToggle={() => toggleSection('classification')}
          >
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Severite</Label>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={suggestSeverity}>
                    <Sparkles className="h-3.5 w-3.5" />
                    Suggestion IA
                  </Button>
                </div>
                <div className="flex gap-2">
                  {(Object.entries(SEVERITY_CONFIG) as [Severity, typeof SEVERITY_CONFIG[Severity]][]).map(([value, config]) => (
                    <Button
                      key={value}
                      variant={formData.severity === value ? 'default' : 'outline'}
                      size="sm"
                      className={cn(formData.severity === value && config.color)}
                      onClick={() => { updateForm({ severity: value }); setAiSuggested(false); }}
                    >
                      {config.label}
                    </Button>
                  ))}
                </div>
                {aiSuggested && (
                  <p className="text-xs text-primary mt-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> Suggestion basee sur les composants impactes
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1.5 block">Categorie</Label>
                  <Select value={formData.category} onValueChange={(v) => updateForm({ category: v as Category })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Priorite</Label>
                  <Select value={formData.priority} onValueChange={(v) => updateForm({ priority: v as Priority })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="P1">P1 — Critique</SelectItem>
                      <SelectItem value="P2">P2 — Haute</SelectItem>
                      <SelectItem value="P3">P3 — Moyenne</SelectItem>
                      <SelectItem value="P4">P4 — Basse</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </SectionAccordion>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || createMutation.isPending}
            className="bg-severity-critical hover:bg-severity-critical/90"
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <AlertTriangle className="mr-2 h-4 w-4" />
            )}
            Declarer l'incident
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Reusable section accordion */
function SectionAccordion({
  title,
  icon: Icon,
  expanded,
  onToggle,
  badge,
  children,
}: {
  title: string;
  icon: typeof FileText;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
          {badge && (
            <Badge variant="outline" className="text-xs">{badge}</Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
