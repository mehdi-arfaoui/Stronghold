import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Square, XCircle } from "lucide-react";
import { Pie, PieChart, ResponsiveContainer, Cell } from "recharts";
import { complianceApi, type ComplianceFrameworkId, type ComplianceStatus } from "@/api/compliance.api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ModuleErrorBoundary } from "@/components/ErrorBoundary";
import { cn } from "@/lib/utils";
import { getCredentialScopeKey } from "@/lib/credentialStorage";

const FRAMEWORKS: Array<{ id: ComplianceFrameworkId; label: string }> = [
  { id: "iso22301", label: "ISO 22301" },
  { id: "nis2", label: "NIS 2" },
];

const STATUS_META: Record<
  ComplianceStatus,
  {
    label: string;
    className: string;
    icon: typeof CheckCircle2;
  }
> = {
  compliant: {
    label: "Conforme",
    className: "text-emerald-700 bg-emerald-100/70 border-emerald-200",
    icon: CheckCircle2,
  },
  partial: {
    label: "Partiel",
    className: "text-amber-700 bg-amber-100/70 border-amber-200",
    icon: AlertTriangle,
  },
  non_compliant: {
    label: "Non conforme",
    className: "text-rose-700 bg-rose-100/70 border-rose-200",
    icon: XCircle,
  },
  unavailable: {
    label: "Non disponible",
    className: "text-slate-600 bg-slate-100 border-slate-200",
    icon: Square,
  },
};

function scoreColor(score: number): string {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#ea580c";
  return "#dc2626";
}

function CompliancePageInner() {
  const [framework, setFramework] = useState<ComplianceFrameworkId>("iso22301");
  const tenantScope = getCredentialScopeKey();

  const reportQuery = useQuery({
    queryKey: ["compliance-report", tenantScope, framework],
    queryFn: async () => (await complianceApi.getReport(framework)).data,
  });

  const report = reportQuery.data;
  const score = report?.overallScore ?? 0;
  const evaluatedRequirements = report?.checks.filter((check) => check.status !== "unavailable").length ?? 0;
  const totalRequirements = report?.checks.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Conformite</h1>
          <p className="text-sm text-muted-foreground">
            Evaluation automatique des exigences ISO 22301 / NIS 2.
          </p>
        </div>
        <div className="flex rounded-lg border bg-card p-1">
          {FRAMEWORKS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={framework === item.id ? "default" : "ghost"}
              onClick={() => setFramework(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {reportQuery.isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {reportQuery.isError && (
        <Card>
          <CardContent className="py-8 text-sm text-rose-700">
            Impossible de charger le rapport de conformite.
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{report.frameworkName}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6 md:flex-row md:items-center">
              <div className="h-52 w-52 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "score", value: Math.max(0, Math.min(100, score)) },
                        { name: "rest", value: Math.max(0, 100 - score) },
                      ]}
                      dataKey="value"
                      innerRadius={58}
                      outerRadius={82}
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                    >
                      <Cell fill={scoreColor(score)} />
                      <Cell fill="#e2e8f0" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none relative -mt-32 text-center">
                  <div className="text-4xl font-semibold">{score}%</div>
                  <div className="text-xs text-muted-foreground">Score global</div>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Score base sur {evaluatedRequirements} exigences evaluees sur {totalRequirements}.
                </p>
                <p className="text-muted-foreground">
                  Score global = (points obtenus / points maximum evalues) x 100
                </p>
                <p className="text-muted-foreground">
                  Les exigences "Non disponible" sont exclues du maximum.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exigences</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">Clause</th>
                      <th className="pb-2 pr-4 font-medium">Titre</th>
                      <th className="pb-2 pr-4 font-medium">Statut</th>
                      <th className="pb-2 pr-4 font-medium">Details</th>
                      <th className="pb-2 pr-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.checks.map((check) => {
                      const meta = STATUS_META[check.status];
                      const Icon = meta.icon;
                      return (
                        <tr key={check.requirementId}>
                          <td className="py-3 pr-4 align-top font-medium">{check.clause}</td>
                          <td className="py-3 pr-4 align-top">
                            <div className="font-medium">{check.title}</div>
                          </td>
                          <td className="py-3 pr-4 align-top">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium",
                                meta.className,
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {meta.label}
                            </span>
                          </td>
                          <td className="py-3 pr-4 align-top text-muted-foreground">{check.details}</td>
                          <td className="py-3 pr-4 align-top">
                            {check.actionUrl ? (
                              <Link className="text-primary hover:underline" to={check.actionUrl}>
                                Ouvrir
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">{report.disclaimer}</p>
        </>
      )}
    </div>
  );
}

export function CompliancePage() {
  return (
    <ModuleErrorBoundary moduleName="Conformite">
      <CompliancePageInner />
    </ModuleErrorBoundary>
  );
}
