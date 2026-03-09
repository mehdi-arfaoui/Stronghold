import { useQuery } from '@tanstack/react-query';
import { complianceApi, type ComplianceFrameworkId } from '@/api/compliance.api';
import { ResilienceGauge } from '@/components/dashboard/ResilienceGauge';
import { WidgetFetchError, WidgetLoading } from './WidgetState';

interface ComplianceWidgetProps {
  framework: ComplianceFrameworkId;
}

export function ComplianceWidget({ framework }: ComplianceWidgetProps) {
  const query = useQuery({
    queryKey: ['dashboard-widget', `compliance-${framework}`],
    queryFn: async () => (await complianceApi.getReport(framework)).data,
    staleTime: 60_000,
  });

  if (query.isLoading) return <WidgetLoading />;
  if (query.isError || !query.data) return <WidgetFetchError onRetry={() => void query.refetch()} />;

  const report = query.data;
  const totalChecks = report.checks.length;
  const compliantChecks = report.checks.filter((check) => check.status === 'compliant').length;

  return (
    <div className="flex h-full items-center justify-between gap-4">
      <ResilienceGauge score={report.overallScore} size={95} showLabel={false} />
      <div className="space-y-1 text-xs">
        <p className="font-medium">{report.frameworkName}</p>
        <p className="text-muted-foreground">
          {compliantChecks}/{totalChecks} contrôles conformes
        </p>
        <p className="text-muted-foreground">Version {report.frameworkVersion}</p>
      </div>
    </div>
  );
}
