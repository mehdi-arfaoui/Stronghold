import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDuration, formatCurrency } from '@/lib/formatters';
import { ResilienceGauge } from '@/components/dashboard/ResilienceGauge';
import type { SimulationResult as SimResult } from '@/types/simulation.types';

interface SimulationResultProps {
  result: SimResult;
}

export function SimulationResult({ result }: SimulationResultProps) {
  return (
    <div className="space-y-6">
      <Card className="border-severity-critical/30 bg-severity-critical/5">
        <CardContent className="p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Cout total estime du scenario</p>
          <p className="mt-2 text-3xl font-bold text-severity-critical">{formatCurrency(result.financialLoss ?? 0)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Somme des noeuds impactes x cout/h x duree estimee de l incident.
          </p>
        </CardContent>
      </Card>

      {/* Impact metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Noeuds down" value={result.nodesDown ?? 0} variant="critical" />
        <MetricCard label="Degrades" value={result.nodesDegraded ?? 0} variant="warning" />
        <MetricCard label="% infra" value={`${Math.round(result.infrastructureImpact ?? 0)}%`} />
        <MetricCard label="Downtime" value={formatDuration(result.estimatedDowntime ?? 0)} />
        <MetricCard label="Perte financiere" value={formatCurrency(result.financialLoss ?? 0)} variant="critical" />
        <div className="flex items-center justify-center">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="text-lg font-bold">
              {result.resilienceScoreBefore ?? 0} <span className="text-muted-foreground">&rarr;</span>{' '}
              <span className="text-severity-critical">{result.resilienceScoreAfter ?? 0}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Before/After gauges */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avant</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ResilienceGauge score={result.resilienceScoreBefore ?? 0} size={140} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Apres</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ResilienceGauge score={result.resilienceScoreAfter ?? 0} size={140} />
          </CardContent>
        </Card>
      </div>

      {/* Impacted services table */}
      {(result.impactedServices?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Services business impactes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead>RTO estime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.impactedServices?.map((svc) => (
                  <TableRow key={svc.serviceName}>
                    <TableCell className="font-medium">{svc.serviceName}</TableCell>
                    <TableCell>
                      <Badge
                        variant={svc?.impact === 'total' ? 'destructive' : svc?.impact === 'degraded' ? 'secondary' : 'outline'}
                      >
                        {svc?.impact === 'total' ? 'Total' : svc?.impact === 'degraded' ? 'Degrade' : 'OK'}
                      </Badge>
                    </TableCell>
                    <TableCell>{svc?.impact !== 'none' ? formatDuration(svc?.estimatedRTO ?? 0) : 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      {(result.recommendations?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommandations</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {result.recommendations?.map((rec, i) => (
                <li key={i} className="flex gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <span>{`${rec.priority} — ${rec.title}: ${rec.action}`}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ label, value, variant }: { label: string; value: string | number; variant?: 'critical' | 'warning' }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${variant === 'critical' ? 'text-severity-critical' : variant === 'warning' ? 'text-severity-medium' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
