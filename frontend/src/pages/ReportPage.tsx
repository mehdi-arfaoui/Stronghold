import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileDown, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/common/LoadingState';
import { reportsApi, type ReportConfig } from '@/api/reports.api';
import { simulationsApi } from '@/api/simulations.api';

export function ReportPage() {
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [selectedSimulations, setSelectedSimulations] = useState<Set<string>>(new Set());
  const [selectedExercises] = useState<Set<string>>(new Set());

  const prereqsQuery = useQuery({
    queryKey: ['report-prerequisites'],
    queryFn: async () => (await reportsApi.getPrerequisites()).data,
  });

  const simulationsQuery = useQuery({
    queryKey: ['simulations'],
    queryFn: async () => (await simulationsApi.getAll()).data,
  });

  const generateMutation = useMutation({
    mutationFn: (config: ReportConfig) => reportsApi.generate(config),
    onSuccess: (response) => {
      const blob = new Blob([response.data as BlobPart], { type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-pra-pca.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Rapport genere');
    },
    onError: () => toast.error('Erreur lors de la generation'),
  });

  if (prereqsQuery.isLoading) return <LoadingState message="Verification des prerequis..." />;

  const prereqs = prereqsQuery.data ?? [];
  const allMet = prereqs.every((p) => p.met);
  const simulations = simulationsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Prerequisites */}
      <Card>
        <CardHeader>
          <CardTitle>Prerequis du rapport</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {prereqs.map((prereq) => (
            <div key={prereq.id} className="flex items-center gap-3">
              {prereq.met ? (
                <CheckCircle2 className="h-5 w-5 text-resilience-high" />
              ) : (
                <XCircle className="h-5 w-5 text-severity-critical" />
              )}
              <span className="text-sm">{prereq.label}</span>
              {prereq.details && <span className="text-xs text-muted-foreground">({prereq.details})</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration du rapport</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as 'pdf' | 'docx')}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="docx">DOCX</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {simulations.length > 0 && (
            <div>
              <Label className="mb-2 block">Simulations a inclure</Label>
              <div className="space-y-2">
                {simulations.filter((s) => s.status === 'completed').map((sim) => (
                  <label key={sim.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedSimulations.has(sim.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedSimulations);
                        if (checked) next.add(sim.id); else next.delete(sim.id);
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

      {/* Generate button */}
      <Button
        className="w-full"
        size="lg"
        disabled={!allMet || generateMutation.isPending}
        onClick={() => generateMutation.mutate({
          format,
          includeSimulations: [...selectedSimulations],
          includeExercises: [...selectedExercises],
        })}
      >
        {generateMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileDown className="mr-2 h-4 w-4" />
        )}
        Generer le rapport PRA/PCA
      </Button>

      {!allMet && (
        <p className="text-center text-sm text-severity-medium">
          Completez tous les prerequis pour pouvoir generer le rapport.
        </p>
      )}
    </div>
  );
}
