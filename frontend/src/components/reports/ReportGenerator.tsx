import { useState, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FileDown,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Globe,
  Shield,
  Settings,
  Layers,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Target,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { reportsApi, type ReportConfig, type ReportPrerequisite } from '@/api/reports.api';
import { simulationsApi } from '@/api/simulations.api';
import { biaApi } from '@/api/bia.api';
import type { Simulation } from '@/types/simulation.types';

type ReportTemplate = 'iso22301' | 'dora' | 'nist' | 'custom';
type ReportFormat = 'pdf' | 'docx' | 'html';
type DetailLevel = 'summary' | 'standard' | 'detailed';
type ReportLang = 'fr' | 'en';

interface ReportSection {
  id: string;
  label: string;
  enabled: boolean;
  generating?: boolean;
  generated?: boolean;
}

const TEMPLATES: { value: ReportTemplate; label: string; description: string; icon: typeof Shield }[] = [
  { value: 'iso22301', label: 'ISO 22301', description: 'Business Continuity Management', icon: Shield },
  { value: 'dora', label: 'DORA', description: 'Digital Operational Resilience Act', icon: Globe },
  { value: 'nist', label: 'NIST SP 800-34', description: 'Contingency Planning Guide', icon: FileText },
  { value: 'custom', label: 'Personnalise', description: 'Template libre', icon: Settings },
];

const DEFAULT_SECTIONS: ReportSection[] = [
  { id: 'executive-summary', label: 'Executive Summary (IA)', enabled: true },
  { id: 'scope', label: 'Perimetre et contexte', enabled: true },
  { id: 'inventory', label: 'Inventaire des actifs', enabled: true },
  { id: 'bia', label: 'Analyse d\'impact (BIA)', enabled: true },
  { id: 'redundancy', label: 'Analyse de redondance', enabled: true },
  { id: 'strategies', label: 'Strategies de continuite', enabled: true },
  { id: 'procedures', label: 'Procedures de reprise', enabled: true },
  { id: 'simulations', label: 'Resultats des simulations', enabled: true },
  { id: 'exercises', label: 'Resultats des exercices', enabled: true },
  { id: 'incidents', label: 'Historique des incidents', enabled: true },
  { id: 'recommendations', label: 'Recommandations', enabled: true },
  { id: 'roadmap', label: 'Plan d\'action et roadmap', enabled: true },
  { id: 'annexes', label: 'Annexes techniques', enabled: true },
];

// ─── Error Boundary ──────────
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ReportErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ReportGenerator error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-lg py-20 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-severity-critical/10">
            <AlertTriangle className="h-8 w-8 text-severity-critical" />
          </div>
          <h2 className="text-xl font-bold mb-2">Une erreur est survenue</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Le module de rapport a rencontre un probleme inattendu.
            {this.state.error?.message && (
              <span className="block mt-1 font-mono text-xs text-severity-critical">
                {this.state.error.message}
              </span>
            )}
          </p>
          <Button
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reessayer
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ─── Empty State ──────────
function ReportEmptyState() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <FileText className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-bold mb-2">Aucun rapport disponible</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Completez d'abord une analyse BIA et lancez une simulation
        pour pouvoir generer votre rapport PRA/PCA.
      </p>
      <Button onClick={() => navigate('/analysis')}>
        Demarrer l'analyse BIA
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Executive Summary ──────────
function ExecutiveSummary({
  prereqs,
  simulationCount,
  biaSummary,
}: {
  prereqs: ReportPrerequisite[];
  simulationCount: number;
  biaSummary: { totalServices: number; validatedCount: number } | null;
}) {
  const safePrereqs = Array.isArray(prereqs) ? prereqs : [];
  const metCount = safePrereqs.filter((p) => p.met).length;
  const coverage = safePrereqs.length > 0 ? Math.round((metCount / safePrereqs.length) * 100) : 0;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Target className="h-8 w-8 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">Processus critiques</p>
            <p className="text-xl font-bold">{biaSummary?.totalServices ?? 0}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <BarChart3 className="h-8 w-8 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">Simulations realisees</p>
            <p className="text-xl font-bold">{simulationCount}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Activity className="h-8 w-8 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">Couverture du plan</p>
            <p className="text-xl font-bold">{coverage}%</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Component ──────────
interface ReportGeneratorProps {
  className?: string;
}

export function ReportGenerator({ className }: ReportGeneratorProps) {
  return (
    <ReportErrorBoundary>
      <ReportGeneratorInner className={className} />
    </ReportErrorBoundary>
  );
}

function ReportGeneratorInner({ className }: ReportGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [currentGeneratingSection, setCurrentGeneratingSection] = useState('');

  // Configuration state
  const [template, setTemplate] = useState<ReportTemplate>('iso22301');
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('standard');
  const [language, setLanguage] = useState<ReportLang>('fr');
  const [includeGraphics, setIncludeGraphics] = useState(true);
  const [sections, setSections] = useState<ReportSection[]>(DEFAULT_SECTIONS);
  const [selectedSimulations, setSelectedSimulations] = useState<Set<string>>(new Set());
  const [selectedExercises] = useState<Set<string>>(new Set());

  const prereqsQuery = useQuery({
    queryKey: ['report-prerequisites'],
    queryFn: async () => {
      const { data } = await reportsApi.getPrerequisites();
      return data;
    },
  });

  const simulationsQuery = useQuery({
    queryKey: ['simulations'],
    queryFn: async () => {
      const { data } = await simulationsApi.getAll();
      return data;
    },
  });

  const biaSummaryQuery = useQuery({
    queryKey: ['bia-summary'],
    queryFn: async () => (await biaApi.getSummary()).data,
  });

  // Defensive: ensure arrays even if API returns unexpected shapes
  const rawPrereqs = prereqsQuery.data;
  const prereqs: ReportPrerequisite[] = Array.isArray(rawPrereqs) ? rawPrereqs : [];
  const allMet = prereqs.length > 0 && prereqs.every((p) => p.met);

  const rawSimulations = simulationsQuery.data;
  const simulations: Simulation[] = Array.isArray(rawSimulations)
    ? rawSimulations
    : Array.isArray((rawSimulations as Record<string, unknown>)?.simulations)
      ? ((rawSimulations as Record<string, unknown>).simulations as Simulation[])
      : [];

  const biaSummary = biaSummaryQuery.data ?? null;
  const enabledSections = sections.filter((s) => s.enabled);

  // Show empty state when no prerequisites data is available
  const hasNoData = !prereqsQuery.isLoading && prereqs.length === 0 && !prereqsQuery.isError;

  const toggleSection = (id: string) => {
    setSections((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const toggleAllSections = (enabled: boolean) => {
    setSections((prev) => prev.map((s) => ({ ...s, enabled })));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);

    // Simulate section-by-section generation
    const enabledList = sections.filter((s) => s.enabled);

    for (let i = 0; i < enabledList.length; i++) {
      const section = enabledList[i];
      setCurrentGeneratingSection(section.label);

      // Mark section as generating
      setSections((prev) =>
        prev.map((s) => (s.id === section.id ? { ...s, generating: true } : s))
      );

      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));

      // Mark section as generated
      setSections((prev) =>
        prev.map((s) =>
          s.id === section.id ? { ...s, generating: false, generated: true } : s
        )
      );

      setGenerationProgress(((i + 1) / enabledList.length) * 100);
    }

    // Final download
    try {
      const config: ReportConfig = {
        format: format === 'html' ? 'pdf' : format,
        includeSimulations: [...selectedSimulations],
        includeExercises: [...selectedExercises],
      };

      const response = await reportsApi.generate(config);

      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data as BlobPart], {
            type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-pra-pca.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Rapport genere et telecharge', {
        description: `Format: ${format.toUpperCase()} — ${enabledList.length} sections`,
      });
    } catch {
      toast.error('Erreur lors de la generation du rapport');
    } finally {
      setIsGenerating(false);
      setCurrentGeneratingSection('');
    }
  };

  const resetGeneration = () => {
    setSections((prev) => prev.map((s) => ({ ...s, generating: false, generated: false })));
    setGenerationProgress(0);
    setIsGenerating(false);
  };

  if (hasNoData) {
    return <ReportEmptyState />;
  }

  const completedSimulations = simulations.filter((s) => s.status === 'completed');

  return (
    <div className={cn('mx-auto max-w-4xl space-y-6', className)}>
      {/* Executive Summary */}
      <ExecutiveSummary
        prereqs={prereqs}
        simulationCount={simulations.length}
        biaSummary={biaSummary ? { totalServices: biaSummary.totalServices, validatedCount: biaSummary.validatedCount } : null}
      />

      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Prerequis du rapport
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {prereqs.map((prereq) => (
            <div key={prereq.id} className="flex items-center gap-3">
              {prereq.met ? (
                <CheckCircle2 className="h-4 w-4 text-resilience-high shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-severity-critical shrink-0" />
              )}
              <span className="text-sm">{prereq.label}</span>
              {prereq.details && <span className="text-xs text-muted-foreground">({prereq.details})</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Generation Progress (when generating) */}
      {isGenerating && (
        <Card className="border-primary/30">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Generation en cours...</h3>
              <span className="text-sm text-muted-foreground">{Math.round(generationProgress)}%</span>
            </div>
            <Progress value={generationProgress} className="h-2" />
            <p className="text-sm text-primary">{currentGeneratingSection}</p>

            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {sections.filter((s) => s.enabled).map((section) => (
                <div key={section.id} className="flex items-center gap-2 text-sm">
                  {section.generated ? (
                    <CheckCircle2 className="h-4 w-4 text-resilience-high shrink-0" />
                  ) : section.generating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className={cn(
                    section.generated && 'text-muted-foreground',
                    section.generating && 'font-medium text-primary'
                  )}>
                    {section.label}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration Panel */}
      {!isGenerating && (
        <>
          {/* Template Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Template de conformite
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.value}
                    type="button"
                    onClick={() => setTemplate(tmpl.value)}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all duration-200',
                      template === tmpl.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-primary/50'
                    )}
                    aria-pressed={template === tmpl.value}
                  >
                    <tmpl.icon className={cn('h-6 w-6', template === tmpl.value ? 'text-primary' : 'text-muted-foreground')} />
                    <div>
                      <p className="text-sm font-medium">{tmpl.label}</p>
                      <p className="text-xs text-muted-foreground">{tmpl.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Sections */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary" />
                Sections ({enabledSections.length}/{sections.length})
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => toggleAllSections(true)}>Tout</Button>
                <Button variant="ghost" size="sm" onClick={() => toggleAllSections(false)}>Aucun</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {sections.map((section) => (
                  <label
                    key={section.id}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors"
                  >
                    <Checkbox
                      checked={section.enabled}
                      onCheckedChange={() => toggleSection(section.id)}
                    />
                    <span>{section.label}</span>
                    {section.generated && <CheckCircle2 className="h-3.5 w-3.5 text-resilience-high ml-auto" />}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Options */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Options
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="mb-1.5 block text-xs">Format</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as ReportFormat)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="docx">DOCX</SelectItem>
                      <SelectItem value="html">HTML interactif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Niveau de detail</Label>
                  <Select value={detailLevel} onValueChange={(v) => setDetailLevel(v as DetailLevel)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="summary">Synthetique</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="detailed">Detaille</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Langue</Label>
                  <Select value={language} onValueChange={(v) => setLanguage(v as ReportLang)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fr">Francais</SelectItem>
                      <SelectItem value="en">Anglais</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs">Graphiques</Label>
                  <div className="flex items-center gap-2 h-10">
                    <Checkbox
                      checked={includeGraphics}
                      onCheckedChange={(checked) => setIncludeGraphics(!!checked)}
                    />
                    <span className="text-sm">Inclure</span>
                  </div>
                </div>
              </div>

              {/* Simulations to include */}
              {completedSimulations.length > 0 && (
                <div className="mt-4">
                  <Label className="mb-2 block text-xs">Simulations a inclure</Label>
                  <div className="space-y-1.5">
                    {completedSimulations.map((sim) => (
                      <label key={sim.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={selectedSimulations.has(sim.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedSimulations);
                            checked ? next.add(sim.id) : next.delete(sim.id);
                            setSelectedSimulations(next);
                          }}
                        />
                        {sim.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Generate Button */}
      <div className="flex gap-3">
        {isGenerating ? (
          <Button variant="outline" className="flex-1" onClick={resetGeneration}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Recommencer
          </Button>
        ) : (
          <Button
            className="flex-1"
            size="lg"
            disabled={!allMet || enabledSections.length === 0}
            onClick={handleGenerate}
          >
            <FileDown className="mr-2 h-4 w-4" />
            Generer le rapport PRA/PCA
          </Button>
        )}
      </div>

      {!allMet && !isGenerating && (
        <p className="text-center text-sm text-severity-medium">
          Completez tous les prerequis pour pouvoir generer le rapport.
        </p>
      )}
    </div>
  );
}
