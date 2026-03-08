// @ts-nocheck
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RunbooksPage } from '@/pages/RunbooksPage';
import { RunbookDetailPage } from '@/pages/RunbookDetailPage';
import { RemediationPage } from '@/pages/RemediationPage';
import { PRAExercisesPage } from '@/pages/PRAExercisesPage';
import { FinancialDashboardPage } from '@/pages/FinancialDashboardPage';
import { BIATable } from '@/components/bia/BIATable';
import { RecommendationsEngine } from '@/components/recommendations/RecommendationsEngine';
import { TooltipProvider } from '@/components/ui/tooltip';

import { runbooksApi } from '@/api/runbooks.api';
import { simulationsApi } from '@/api/simulations.api';
import { remediationApi } from '@/api/remediation.api';
import { recommendationsApi } from '@/api/recommendations.api';
import { praExercisesApi } from '@/api/pra-exercises.api';
import { financialApi } from '@/api/financial.api';
import { reportsApi } from '@/api/reports.api';
import { discoveryApi } from '@/api/discovery.api';
import { biaApi } from '@/api/bia.api';
import { api } from '@/api/client';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('@/api/runbooks.api', () => ({
  runbooksApi: {
    getAll: vi.fn(),
    getById: vi.fn(),
    generate: vi.fn(),
    update: vi.fn(),
    validate: vi.fn(),
  },
}));

vi.mock('@/api/simulations.api', () => ({
  simulationsApi: {
    getAll: vi.fn(),
  },
}));

vi.mock('@/api/remediation.api', () => ({
  remediationApi: {
    getAll: vi.fn(),
    getSummary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/api/recommendations.api', () => ({
  recommendationsApi: {
    getAll: vi.fn(),
    getSummary: vi.fn(),
    updateStatus: vi.fn(),
    regenerate: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'admin-user',
      tenantId: 'tenant-1',
      email: 'admin@stronghold.local',
      displayName: 'Admin',
      role: 'ADMIN',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
    },
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
  }),
}));

vi.mock('@/api/pra-exercises.api', () => ({
  praExercisesApi: {
    getAll: vi.fn(),
    getComparison: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/api/financial.api', () => ({
  financialApi: {
    getOrgProfile: vi.fn(),
    getSummary: vi.fn(),
    getTrend: vi.fn(),
    calculateROI: vi.fn(),
    getBenchmarks: vi.fn(),
    updateOrgProfile: vi.fn(),
  },
}));

vi.mock('@/api/reports.api', () => ({
  reportsApi: {
    getPrerequisites: vi.fn(),
    generate: vi.fn(),
    getPreview: vi.fn(),
    generateExecutiveFinancialSummary: vi.fn(),
    generatePptx: vi.fn(),
  },
}));

vi.mock('@/api/discovery.api', () => ({
  discoveryApi: {
    getGraph: vi.fn(),
  },
}));

vi.mock('@/api/bia.api', () => ({
  biaApi: {
    getEntries: vi.fn(),
  },
}));

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('@/hooks/useLicense', () => ({
  useLicense: () => ({
    query: {},
    license: {
      plan: 'pro',
      features: ['executive-dashboard', 'api-export'],
    },
    isLoading: false,
    isFetching: false,
    isOperational: true,
    plan: 'pro',
    hasFeature: (feature: string) => ['executive-dashboard', 'api-export'].includes(feature),
    needsActivation: false,
    isExpired: false,
    isGracePeriod: false,
    daysUntilExpiry: null,
  }),
}));

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function asApiResult<T>(data: T): Promise<{ data: T }> {
  return Promise.resolve({ data });
}

describe('Operational UX QA flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      data: {
        base: 'USD',
        rates: { USD: 1, EUR: 0.92, GBP: 0.79, CHF: 0.88 },
        source: 'test',
        cachedAt: '2026-02-16T10:00:00.000Z',
      },
    } as any);
    vi.mocked(financialApi.getBenchmarks).mockResolvedValue({
      data: {
        downtime: {
          enterprise: {
            label: 'Enterprise',
            perHourUSD: { p25: 300000, median: 500000, p75: 1000000, p95: 5000000 },
            source: 'ITIC 2024',
          },
          midMarket: {
            label: 'Mid-market',
            perHourUSD: { p25: 100000, median: 300000, p75: 500000, p95: 1000000 },
            source: 'EMA 2024',
          },
          smb: {
            label: 'SMB',
            perHourUSD: { p25: 10000, median: 50000, p75: 100000, p95: 300000 },
            source: 'ITIC 2024',
          },
          byVertical: {},
        },
      },
    } as any);
    vi.mocked(recommendationsApi.getSummary).mockImplementation(async () =>
      asApiResult({
        totalAnnualCost: 0,
        totalRecommendations: 0,
        secondaryRecommendations: 0,
        secondaryAnnualCost: 0,
        annualCostByStrategy: {},
        costSharePercentByStrategy: {},
        annualCostCap: 0,
        riskAvoidedAnnual: 0,
        roiPercent: null,
        paybackMonths: null,
        financialProfileConfigured: false,
      } as any),
    );

    vi.mocked(financialApi.getTrend).mockResolvedValue({
      data: {
        lookbackMonths: 6,
        currency: 'EUR',
        hasEnoughHistory: true,
        points: [
          {
            analysisId: 'analysis-1',
            scanDate: '2026-01-01T10:00:00.000Z',
            resilienceScore: 74,
            ale: 680000,
            spofCount: 4,
            criticalDriftCount: 0,
            criticalDriftAdditionalRisk: 0,
            annotations: [],
          },
          {
            analysisId: 'analysis-2',
            scanDate: '2026-02-01T10:00:00.000Z',
            resilienceScore: 78,
            ale: 610000,
            spofCount: 3,
            criticalDriftCount: 1,
            criticalDriftAdditionalRisk: 45000,
            annotations: [
              {
                driftId: 'drift-1',
                occurredAt: '2026-02-01T09:00:00.000Z',
                label: 'Drift detecte: db-primary (+45 000 EUR/an de risque)',
                additionalAnnualRisk: 45000,
                nodeName: 'db-primary',
              },
            ],
          },
        ],
        sources: ['Uptime Institute 2025'],
        disclaimer: 'test',
        generatedAt: '2026-02-16T10:00:00.000Z',
      },
    } as any);

    vi.mocked(discoveryApi.getGraph).mockResolvedValue({
      data: {
        nodes: [
          {
            id: 'node-1',
            name: 'payment-service',
            type: 'APPLICATION',
            provider: 'aws',
            region: 'eu-west-3',
          },
        ],
        edges: [],
      },
    } as any);

    vi.mocked(biaApi.getEntries).mockResolvedValue({
      data: {
        entries: [
          {
            id: 'bia-1',
            nodeId: 'node-1',
            serviceName: 'payment-service',
            serviceType: 'APPLICATION',
            tier: 1,
            rto: 120,
            rpo: 30,
            mtpd: 480,
            rtoSuggested: 120,
            rpoSuggested: 30,
            mtpdSuggested: 480,
            validated: true,
            downtimeCostPerHour: 4500,
            downtimeCostSourceLabel: '50% - 1 service impacte',
            blastRadius: {
              directDependents: 1,
              transitiveDependents: 1,
              totalServices: 3,
              impactedServices: ['node-2'],
            },
            dependencies: [],
          },
        ],
        tiers: {},
      },
    } as any);
  });

  it('Parcours 1 - Runbook complet (generation, redirection, flow lineaire)', async () => {
    const user = userEvent.setup();

    const runbookState = {
      id: 'rb-1',
      title: 'Runbook payment region failover',
      description: 'Recovery playbook generated from simulation.',
      summary: 'Recovery playbook generated from simulation.',
      status: 'draft',
      simulationId: 'sim-1',
      recommendationId: null,
      responsible: 'SRE',
      accountable: 'CTO',
      consulted: 'SecOps',
      informed: 'Business Owner',
      lastTestedAt: null,
      testResult: null,
      generatedAt: '2026-02-16T10:00:00.000Z',
      updatedAt: '2026-02-16T10:00:00.000Z',
      steps: [
        {
          order: 1,
          title: 'Detection',
          description: 'Confirm incident and identify impacted nodes.',
          type: 'manual' as const,
          estimatedDurationMinutes: 10,
          assignedRole: 'NOC',
          commands: ['kubectl get pods -A'],
        },
        {
          order: 2,
          title: 'Evaluation',
          description: 'Validate blast radius and data consistency risk.',
          type: 'decision' as const,
          estimatedDurationMinutes: 12,
          assignedRole: 'Incident Manager',
          commands: ['aws cloudwatch get-metric-data --region eu-west-1'],
        },
        {
          order: 3,
          title: 'Communication',
          description: 'Broadcast incident status and RTO commitment.',
          type: 'notification' as const,
          estimatedDurationMinutes: 8,
          assignedRole: 'Comms',
          commands: ['echo "incident notice" | mail -s "PRA" ops@example.com'],
        },
        {
          order: 4,
          title: 'Recovery',
          description: 'Trigger regional failover for primary database.',
          type: 'automated' as const,
          estimatedDurationMinutes: 25,
          assignedRole: 'DBA',
          commands: ['aws rds failover-db-cluster --db-cluster-identifier db-primary'],
        },
        {
          order: 5,
          title: 'Verification',
          description: 'Run smoke checks and validate user flows.',
          type: 'manual' as const,
          estimatedDurationMinutes: 15,
          assignedRole: 'QA',
          commands: ['npm run smoke:test'],
        },
        {
          order: 6,
          title: 'Post-mortem',
          description: 'Capture findings and define remediation actions.',
          type: 'manual' as const,
          estimatedDurationMinutes: 20,
          assignedRole: 'Incident Manager',
          commands: ['echo "post-mortem" > report.md'],
        },
      ],
    };

    vi.mocked(simulationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'sim-1',
          name: 'Region outage payments',
          scenarioType: 'region_loss',
        },
      ]),
    );

    vi.mocked(runbooksApi.getAll).mockImplementation(async () => asApiResult([]));

    vi.mocked(runbooksApi.generate).mockImplementation(async () =>
      asApiResult({
        runbook: {
          id: runbookState.id,
        },
      }),
    );

    vi.mocked(runbooksApi.getById).mockImplementation(async () => asApiResult({ ...runbookState }));

    vi.mocked(runbooksApi.validate).mockImplementation(async () => {
      runbookState.status = 'validated';
      runbookState.testResult = 'passed';
      runbookState.lastTestedAt = '2026-02-16T10:20:00.000Z';
      runbookState.updatedAt = '2026-02-16T10:20:00.000Z';
      return asApiResult({ ...runbookState });
    });

    vi.mocked(runbooksApi.update).mockImplementation(async (_id, payload) => {
      const status = String(payload.status ?? '');
      if (status === 'tested') {
        runbookState.status = 'tested';
        runbookState.testResult = 'passed';
        runbookState.lastTestedAt = '2026-02-16T10:30:00.000Z';
      }
      if (status === 'active') {
        runbookState.status = 'active';
      }
      runbookState.updatedAt = '2026-02-16T10:40:00.000Z';
      return asApiResult({ ...runbookState });
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/simulations/runbooks']}>
          <Routes>
            <Route path="/simulations/runbooks" element={<RunbooksPage />} />
            <Route path="/simulations/runbooks/:id" element={<RunbookDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Runbooks operationnels');

    await user.selectOptions(screen.getByRole('combobox'), 'sim-1');
    await user.click(screen.getByRole('button', { name: /Generer depuis une simulation/i }));

    await screen.findByRole('heading', { name: /Runbook payment region failover/i });

    expect(screen.queryByRole('button', { name: /Activer/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Commandes CLI')).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: /Valider/i }));
    await screen.findByText('validated');

    await user.click(screen.getByRole('button', { name: /Marquer comme teste/i }));
    await screen.findByText('tested');
    expect(screen.getByText(/Dernier test:/).textContent).not.toContain('-');

    await user.click(screen.getByRole('button', { name: /Activer/i }));
    await screen.findByText('active');
  }, 10000);

  it('Parcours 2 - Kanban remediation (creation, retard, DnD, progression, filtre)', async () => {
    const user = userEvent.setup();
    let tasks: Array<Record<string, unknown>> = [];

    const buildSummary = () => {
      const byStatus: Record<string, number> = {
        todo: 0,
        in_progress: 0,
        done: 0,
        blocked: 0,
        cancelled: 0,
      };

      for (const task of tasks) {
        const status = String(task.status);
        byStatus[status] = (byStatus[status] ?? 0) + 1;
      }

      const total = tasks.length;
      const doneCount = byStatus.done;

      return {
        total,
        byStatus,
        byPriority: {
          critical: tasks.filter((task) => task.priority === 'critical').length,
          high: tasks.filter((task) => task.priority === 'high').length,
          medium: tasks.filter((task) => task.priority === 'medium').length,
          low: tasks.filter((task) => task.priority === 'low').length,
        },
        doneCount,
        completionRate: total === 0 ? 0 : Math.round((doneCount / total) * 100),
        estimatedCostTotal: tasks.reduce((acc, task) => acc + Number(task.estimatedCost ?? 0), 0),
        actualCostTotal: 0,
      };
    };

    vi.mocked(recommendationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'rec-1',
          title: 'Enable multi-AZ database',
          description: 'Reduce SPOF on primary database',
          priority: 'P1',
        },
      ]),
    );

    vi.mocked(remediationApi.getAll).mockImplementation(async () => asApiResult([...tasks] as any));
    vi.mocked(remediationApi.getSummary).mockImplementation(async () => asApiResult(buildSummary() as any));

    vi.mocked(remediationApi.create).mockImplementation(async (payload: any) => {
      const created = {
        id: 'task-1',
        title: payload.title,
        recommendationId: payload.recommendationId,
        status: 'todo',
        priority: payload.priority,
        assignee: payload.assignee ?? null,
        dueDate: payload.dueDate ?? null,
        completedAt: null,
        estimatedCost: payload.estimatedCost ?? null,
        actualCost: null,
        riskReduction: null,
        createdAt: '2026-02-16T10:00:00.000Z',
        updatedAt: '2026-02-16T10:00:00.000Z',
      };
      tasks = [created];
      return asApiResult(created as any);
    });

    vi.mocked(remediationApi.update).mockImplementation(async (id: string, payload: any) => {
      tasks = tasks.map((task) => {
        if (task.id !== id) return task;
        return {
          ...task,
          ...payload,
          updatedAt: '2026-02-16T10:10:00.000Z',
        };
      });

      const updated = tasks.find((task) => task.id === id);
      return asApiResult(updated as any);
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/recommendations/remediation']}>
          <Routes>
            <Route path="/recommendations/remediation" element={<RemediationPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Suivi remediation');

    await user.click(screen.getAllByRole('button', { name: /Nouvelle tache/i })[0]);

    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getAllByRole('textbox')[0];
    await user.type(titleInput, 'Database failover rollout');

    const dialogCombos = within(dialog).getAllByRole('combobox');
    await user.selectOptions(dialogCombos[0], 'rec-1');
    await user.selectOptions(dialogCombos[1], 'critical');

    const dueInput = dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    const costInput = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(dueInput, { target: { value: '2025-01-01T10:00' } });
    fireEvent.change(costInput, { target: { value: '3000' } });

    await user.click(within(dialog).getByRole('button', { name: /^Creer$/i }));

    const taskCard = await screen.findByTestId('task-card-task-1');
    expect(within(taskCard).getByText(/Due date:/).className).toContain('text-red-600');

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type];
      },
    };

    fireEvent.dragStart(taskCard, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('kanban-column-in_progress'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('kanban-column-in_progress'), { dataTransfer });

    await screen.findByText('Avancement incluant les actions en cours: 50%');

    const movedCard = await screen.findByTestId('task-card-task-1');
    fireEvent.dragStart(movedCard, { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('kanban-column-done'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('kanban-column-done'), { dataTransfer });

    await screen.findByText('1/1 actions completees (100%)');

    const priorityFilter = screen.getByDisplayValue('Priorite: toutes');
    await user.selectOptions(priorityFilter, 'high');
    await screen.findByText('Aucun resultat avec les filtres selectionnes.');
  });

  it('Parcours 3 - Exercice PRA compare predit vs reel avec warning >30%', async () => {
    const user = userEvent.setup();
    let exercises: Array<Record<string, any>> = [];

    const runbook = {
      id: 'rb-1',
      title: 'Runbook payment failover',
      status: 'tested',
      generatedAt: '2026-02-16T10:00:00.000Z',
      updatedAt: '2026-02-16T10:00:00.000Z',
    };

    vi.mocked(runbooksApi.getAll).mockImplementation(async () => asApiResult([runbook] as any));

    vi.mocked(praExercisesApi.getAll).mockImplementation(async () => asApiResult(exercises as any));

    vi.mocked(praExercisesApi.create).mockImplementation(async (payload: any) => {
      const created = {
        id: 'ex-1',
        title: payload.title,
        description: payload.description ?? null,
        runbookId: payload.runbookId ?? null,
        simulationId: null,
        scheduledAt: payload.scheduledAt,
        executedAt: null,
        duration: null,
        status: 'planned',
        outcome: null,
        actualRTO: null,
        actualRPO: null,
        findings: null,
        predictedRTO: payload.predictedRTO ?? null,
        predictedRPO: payload.predictedRPO ?? null,
        deviationRTO: null,
        deviationRPO: null,
        runbook,
        createdAt: '2026-02-16T10:00:00.000Z',
        updatedAt: '2026-02-16T10:00:00.000Z',
      };
      exercises = [created];
      return asApiResult(created as any);
    });

    vi.mocked(praExercisesApi.update).mockImplementation(async (id: string, payload: any) => {
      exercises = exercises.map((exercise) => {
        if (exercise.id !== id) return exercise;
        const predictedRTO = exercise.predictedRTO;
        const predictedRPO = exercise.predictedRPO;
        const actualRTO = payload.actualRTO ?? null;
        const actualRPO = payload.actualRPO ?? null;

        return {
          ...exercise,
          ...payload,
          status: payload.status ?? exercise.status,
          actualRTO,
          actualRPO,
          deviationRTO:
            typeof predictedRTO === 'number' && typeof actualRTO === 'number'
              ? actualRTO - predictedRTO
              : null,
          deviationRPO:
            typeof predictedRPO === 'number' && typeof actualRPO === 'number'
              ? actualRPO - predictedRPO
              : null,
          updatedAt: '2026-02-16T10:20:00.000Z',
        };
      });

      const updated = exercises.find((exercise) => exercise.id === id);
      return asApiResult(updated as any);
    });

    vi.mocked(praExercisesApi.getComparison).mockImplementation(async (id: string) => {
      const exercise = exercises.find((entry) => entry.id === id);
      return asApiResult({
        id: exercise?.id,
        title: exercise?.title,
        status: exercise?.status,
        scheduledAt: exercise?.scheduledAt,
        executedAt: exercise?.executedAt,
        duration: exercise?.duration,
        outcome: exercise?.outcome,
        predicted: { rto: exercise?.predictedRTO ?? null, rpo: exercise?.predictedRPO ?? null },
        actual: { rto: exercise?.actualRTO ?? null, rpo: exercise?.actualRPO ?? null },
        deviation: { rto: exercise?.deviationRTO ?? null, rpo: exercise?.deviationRPO ?? null },
        findings: exercise?.findings ?? null,
        runbook: exercise?.runbook ?? null,
        simulation: null,
      } as any);
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/simulations/pra-exercises']}>
          <Routes>
            <Route path="/simulations/pra-exercises" element={<PRAExercisesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Exercices PRA');

    await user.click(screen.getAllByRole('button', { name: /Planifier un exercice/i })[0]);

    const dialog = await screen.findByRole('dialog');
    const titleInput = within(dialog).getAllByRole('textbox')[0];
    await user.type(titleInput, 'PRA payment failover dry-run');

    const runbookSelect = within(dialog).getByRole('combobox');
    await user.selectOptions(runbookSelect, 'rb-1');

    const scheduledInput = dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(scheduledInput, { target: { value: '2026-02-20T09:00' } });

    const numberInputs = dialog.querySelectorAll('input[type="number"]');
    fireEvent.change(numberInputs[0], { target: { value: '120' } });
    fireEvent.change(numberInputs[1], { target: { value: '30' } });

    await user.click(within(dialog).getByRole('button', { name: /^Planifier$/i }));

    expect(await screen.findAllByText('PRA payment failover dry-run')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /Saisir les resultats/i }));

    const resultsDialog = await screen.findByRole('dialog');
    const resultNumbers = resultsDialog.querySelectorAll('input[type="number"]');

    fireEvent.change(resultNumbers[0], { target: { value: '300' } });
    fireEvent.change(resultNumbers[1], { target: { value: '40' } });
    fireEvent.change(resultNumbers[2], { target: { value: '180' } });

    await user.click(within(resultsDialog).getByRole('button', { name: /^Enregistrer$/i }));

    await screen.findByText(/\+180 min/);
    await screen.findByText(/Ecart significatif - envisagez de recalibrer les estimations BIA\./i);
  });

  it('Parcours 4 - Integration financiere (dashboard, recommandations, BIA override)', async () => {
    vi.mocked(financialApi.getOrgProfile).mockImplementation(async () =>
      asApiResult({
        isConfigured: true,
        customCurrency: 'EUR',
      }),
    );

    vi.mocked(financialApi.getSummary).mockImplementation(async () =>
      asApiResult({
        metrics: {
          annualRisk: 847000,
          potentialSavings: 554500,
          roiPercent: 1443,
          paybackMonths: 0.8,
        },
        totals: {
          totalSPOFs: 4,
          avgDowntimeHoursPerIncident: 3,
        },
        topSPOFs: [
          {
            nodeId: 'node-1',
            nodeName: 'db-primary',
            nodeType: 'DATABASE',
            ale: 360000,
            probability: 0.15,
            estimatedDowntimeHours: 4,
            costPerHour: 6000,
            dependentsCount: 12,
          },
        ],
        ale: {
          totalALE: 847000,
          sources: ['Uptime Institute 2025'],
          disclaimer: 'Estimated values based on public benchmarks.',
          currency: 'EUR',
        },
        roi: {
          currentALE: 847000,
          projectedALE: 254100,
          annualRemediationCost: 38400,
          riskReduction: 70,
          riskReductionAmount: 592900,
          roiPercent: 1443,
          paybackMonths: 0.8,
          sources: ['ITIC 2024'],
          disclaimer: 'Estimated ROI only.',
        },
        organizationProfile: {
          sizeCategory: 'midMarket',
          customCurrency: 'EUR',
        },
        regulatoryExposure: {
          nis2: { applicable: false },
          dora: { applicable: false },
          gdpr: { applicable: true },
        },
        disclaimer: 'Estimated values based on public benchmarks.',
        sources: ['ITIC 2024', 'Uptime 2025'],
        currency: 'EUR',
        generatedAt: '2026-02-16T10:00:00.000Z',
      } as any),
    );

    vi.mocked(recommendationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'rec-quick-win',
          title: 'Enable warm standby',
          serviceName: 'payment-api',
          description: 'Deploy warm standby region for payment-api',
          tier: 1,
          strategy: 'warm-standby',
          estimatedCost: 200,
          priority: 'P1',
        },
      ] as any),
    );
    vi.mocked(recommendationsApi.getSummary).mockImplementation(async () =>
      asApiResult({
        totalAnnualCost: 2400,
        totalRecommendations: 1,
        secondaryRecommendations: 0,
        secondaryAnnualCost: 0,
        annualCostByStrategy: {
          warm_standby: 2400,
        },
        costSharePercentByStrategy: {
          warm_standby: 100,
        },
        annualCostCap: 7700,
        riskAvoidedAnnual: 20000,
        roiPercent: 733,
        paybackMonths: 0.8,
        budgetAnnual: 12000,
        financialProfileConfigured: true,
      } as any),
    );

    vi.mocked(financialApi.calculateROI).mockImplementation(async () =>
      asApiResult({
        currentALE: 847000,
        projectedALE: 254100,
        riskReduction: 70,
        riskReductionAmount: 592900,
        annualRemediationCost: 38400,
        netAnnualSavings: 554500,
        roiPercent: 1443,
        paybackMonths: 0.8,
        strongholdSubscriptionAnnual: 9600,
        breakdownByRecommendation: [
          {
            recommendationId: 'rec-quick-win',
            strategy: 'warm_standby',
            targetNodes: ['node-1'],
            annualCost: 2400,
            riskReduction: 20000,
            individualROI: 733,
          },
        ],
        methodology: 'Stronghold financial engine',
        sources: ['ITIC 2024'],
        disclaimer: 'Estimated ROI only.',
        currency: 'EUR',
        calculatedAt: '2026-02-16T10:00:00.000Z',
      } as any),
    );

    const dashboardRender = render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/finance']}>
          <Routes>
            <Route path="/finance" element={<FinancialDashboardPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('ROI & Finance');
    expect(screen.getByText(/847/)).toBeInTheDocument();
    expect(screen.getByText(/554/)).toBeInTheDocument();
    expect(screen.getByText(/(1443\.0%|>\s*1000%)/)).toBeInTheDocument();
    expect(screen.getByText(/0,8 mois/)).toBeInTheDocument();
    expect(await screen.findByText(/Total affiché :\s*100%/)).toBeInTheDocument();
    dashboardRender.unmount();

    const recommendationsRender = render(
      <MemoryRouter>
        <QueryClientProvider client={createQueryClient()}>
          <RecommendationsEngine />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: /ROI de vos recommandations|Budget DR/i });
    await screen.findByText(/Action:\s*Warm Standby/i);
    recommendationsRender.unmount();

    render(
      <TooltipProvider>
        <BIATable
          entries={[
            {
              id: 'bia-1',
              nodeId: 'node-1',
              serviceName: 'payment-service',
              serviceType: 'APPLICATION',
              tier: 1,
              rto: 120,
              rpo: 30,
              mtpd: 480,
              rtoSuggested: 120,
              rpoSuggested: 30,
              mtpdSuggested: 480,
              validated: true,
              financialImpactPerHour: 4500,
              financialIsOverride: false,
              dependencies: [],
            },
          ]}
          onUpsertFinancialOverride={vi.fn()}
        />
      </TooltipProvider>,
    );

    const costCellButton = screen.getByRole('button', { name: /\/h/i });
    fireEvent.click(costCellButton);

    await screen.findByText('Override coût d’indisponibilité');
    const amountInput = screen.getByRole('spinbutton');
    expect((amountInput as HTMLInputElement).value).toBe('4500');
  });

  it('Parcours 5 - Nouveau utilisateur end-to-end (export, ROI, override, runbook active)', async () => {
    const user = userEvent.setup();

    const pdfBlob = new Blob([new Uint8Array(4096)], { type: 'application/pdf' });
    const originalCreateObjectURL = (URL as any).createObjectURL;
    const originalRevokeObjectURL = (URL as any).revokeObjectURL;
    const createObjectUrlSpy = vi.fn(() => 'blob:qa-exec-report');
    const revokeObjectUrlSpy = vi.fn(() => undefined);
    (URL as any).createObjectURL = createObjectUrlSpy;
    (URL as any).revokeObjectURL = revokeObjectUrlSpy;
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    let profileConfigured = false;
    vi.mocked(financialApi.getOrgProfile).mockImplementation(async () =>
      asApiResult({
        isConfigured: profileConfigured,
        sizeCategory: profileConfigured ? 'midMarket' : undefined,
        verticalSector: profileConfigured ? 'banking_finance' : null,
        customCurrency: 'EUR',
      } as any),
    );

    vi.mocked(financialApi.updateOrgProfile).mockImplementation(async () => {
      profileConfigured = true;
      return asApiResult({ ok: true } as any);
    });

    vi.mocked(financialApi.getSummary).mockImplementation(async () =>
      asApiResult({
        metrics: {
          annualRisk: 847000,
          potentialSavings: 554500,
          roiPercent: 1443,
          paybackMonths: 0.8,
        },
        totals: {
          totalSPOFs: 4,
          avgDowntimeHoursPerIncident: 3,
        },
        topSPOFs: [
          {
            nodeId: 'node-1',
            nodeName: 'db-primary',
            nodeType: 'DATABASE',
            ale: 360000,
            probability: 0.15,
            estimatedDowntimeHours: 4,
            costPerHour: 6000,
            dependentsCount: 12,
          },
          {
            nodeId: 'node-2',
            nodeName: 'api-gateway',
            nodeType: 'API_GATEWAY',
            ale: 144000,
            probability: 0.15,
            estimatedDowntimeHours: 4,
            costPerHour: 2400,
            dependentsCount: 8,
          },
        ],
        ale: {
          totalALE: 847000,
          sources: ['ITIC 2024', 'Uptime Institute 2025'],
          disclaimer: 'Estimated values based on public benchmarks.',
          currency: 'EUR',
        },
        roi: {
          currentALE: 847000,
          projectedALE: 254100,
          annualRemediationCost: 38400,
          riskReduction: 70,
          riskReductionAmount: 592900,
          roiPercent: 1443,
          paybackMonths: 0.8,
          sources: ['ITIC 2024'],
          disclaimer: 'Estimated ROI only.',
        },
        organization: {
          id: 'tenant-1',
          name: 'Acme Bank Europe',
        },
        organizationProfile: {
          sizeCategory: 'midMarket',
          customCurrency: 'EUR',
          verticalSector: 'banking_finance',
        },
        regulatoryExposure: {
          coverageScore: 80,
          applicableRegulations: [
            {
              id: 'nis2',
              label: 'NIS2',
              maxFine: '10M EUR ou 2% du CA mondial',
              complianceDeadline: '2026-10-17',
              coverageScore: 80,
              source: 'NIS2 Directive',
            },
            {
              id: 'dora',
              label: 'DORA',
              maxFine: '1% du CA mondial quotidien moyen par jour',
              complianceDeadline: '2025-01-17',
              coverageScore: 80,
              source: 'DORA Regulation',
            },
          ],
          moduleSignals: {
            discoveryCompleted: true,
            biaCompleted: true,
            simulationExecutedLast30Days: true,
            activeRunbookAvailable: true,
            praExerciseExecutedLast90Days: false,
            completedControls: 4,
            totalControls: 5,
            coverageScore: 80,
          },
          nis2: { applicable: true },
          dora: { applicable: true },
          gdpr: { applicable: true },
        },
        disclaimer: 'Estimated values based on public benchmarks.',
        sources: ['ITIC 2024', 'Uptime Institute 2025', 'New Relic 2025'],
        currency: 'EUR',
        generatedAt: '2026-02-16T10:00:00.000Z',
      } as any),
    );

    vi.mocked(financialApi.getTrend).mockImplementation(async () =>
      asApiResult({
        lookbackMonths: 6,
        currency: 'EUR',
        hasEnoughHistory: false,
        message: 'Lancez des scans reguliers pour visualiser la tendance de votre resilience.',
        points: [],
        sources: ['Uptime Institute 2025'],
        disclaimer: 'trend disclaimer',
        generatedAt: '2026-02-16T10:00:00.000Z',
      } as any),
    );

    vi.mocked(reportsApi.generateExecutiveFinancialSummary).mockImplementation(async () =>
      asApiResult(pdfBlob as any),
    );

    vi.mocked(recommendationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'rec-quick-win',
          title: 'Enable warm standby',
          serviceName: 'payment-api',
          description: 'Deploy warm standby region for payment-api',
          tier: 1,
          strategy: 'warm-standby',
          estimatedCost: 200,
          priority: 'P1',
          nodeId: 'node-1',
        },
      ] as any),
    );
    vi.mocked(recommendationsApi.getSummary).mockImplementation(async () =>
      asApiResult({
        totalAnnualCost: 2400,
        totalRecommendations: 1,
        secondaryRecommendations: 0,
        secondaryAnnualCost: 0,
        annualCostByStrategy: {
          warm_standby: 2400,
        },
        costSharePercentByStrategy: {
          warm_standby: 100,
        },
        annualCostCap: 7700,
        riskAvoidedAnnual: 20000,
        roiPercent: 733,
        paybackMonths: 0.8,
        budgetAnnual: 12000,
        financialProfileConfigured: false,
      } as any),
    );

    vi.mocked(financialApi.calculateROI).mockImplementation(async () =>
      asApiResult({
        currentALE: 847000,
        projectedALE: 254100,
        riskReduction: 70,
        riskReductionAmount: 592900,
        annualRemediationCost: 38400,
        netAnnualSavings: 554500,
        roiPercent: 1443,
        paybackMonths: 0.8,
        strongholdSubscriptionAnnual: 9600,
        breakdownByRecommendation: [
          {
            recommendationId: 'rec-quick-win',
            strategy: 'warm_standby',
            targetNodes: ['node-1'],
            annualCost: 2400,
            riskReduction: 20000,
            individualROI: 733,
          },
        ],
        methodology: 'Stronghold financial engine',
        sources: ['ITIC 2024'],
        disclaimer: 'Estimated ROI only.',
        currency: 'EUR',
        calculatedAt: '2026-02-16T10:00:00.000Z',
      } as any),
    );

    const financeRender = render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/finance']}>
          <Routes>
            <Route path="/finance" element={<FinancialDashboardPage />} />
            <Route path="/settings" element={<div>Settings Finance</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('ROI & Finance');
    expect(screen.getByText(/847/)).toBeInTheDocument();
    expect(screen.getByText(/Profil financier non configuré - ROI non disponible\./i)).toBeInTheDocument();
    expect(screen.getByText('DORA')).toBeInTheDocument();
    expect(screen.getByText('NIS2')).toBeInTheDocument();
    expect(screen.getByText(/Lancez des scans reguliers pour visualiser la tendance de votre resilience\./i)).toBeInTheDocument();
    expect(screen.getByText('Méthodologie & Sources')).toBeInTheDocument();
    expect(await screen.findByText(/Total affiché :\s*100%/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Exporter le rapport exécutif/i }));

    await waitFor(() => {
      expect(reportsApi.generateExecutiveFinancialSummary).toHaveBeenCalledTimes(1);
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
      expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    });

    const exportedBlob = (createObjectUrlSpy.mock.calls[0]?.[0] as Blob | undefined) ?? null;
    expect(exportedBlob).not.toBeNull();
    expect((exportedBlob as Blob).size).toBeGreaterThan(3 * 1024);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    const configureButtons = screen.getAllByRole('button', { name: /Configurer le profil financier/i });
    await user.click(configureButtons[0]!);
    await screen.findByText('Settings Finance');
    financeRender.unmount();

    const recRender = render(
      <MemoryRouter>
        <QueryClientProvider client={createQueryClient()}>
          <RecommendationsEngine />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: /ROI de vos recommandations|Budget DR/i });
    await screen.findByText(/Action:\s*Warm Standby/i);
    recRender.unmount();

    const initialBiaRows = [
      {
        id: 'bia-1',
        nodeId: 'node-1',
        serviceName: 'payment-service',
        serviceType: 'APPLICATION',
        tier: 1,
        rto: 120,
        rpo: 30,
        mtpd: 480,
        rtoSuggested: 120,
        rpoSuggested: 30,
        mtpdSuggested: 480,
        validated: true,
        financialImpactPerHour: 4500,
        financialIsOverride: false,
        dependencies: [],
      },
    ];

    const upsertFinancialOverrideSpy = vi.fn(async (_nodeId: string, payload: { customCostPerHour: number; justification?: string }) => {
      return payload;
    });

    function BIATableHarness() {
      const [rows, setRows] = useState(initialBiaRows as any[]);
      return (
        <TooltipProvider>
          <BIATable
            entries={rows}
            onUpsertFinancialOverride={async (_nodeId, payload) => {
              await upsertFinancialOverrideSpy(_nodeId, payload);
              setRows((previous) =>
                previous.map((entry) => ({
                  ...entry,
                  financialImpactPerHour: payload.customCostPerHour,
                  financialIsOverride: true,
                  financialOverride: {
                    customCostPerHour: payload.customCostPerHour,
                    justification: payload.justification ?? null,
                  },
                })),
              );
            }}
          />
        </TooltipProvider>
      );
    }

    const biaRender = render(<BIATableHarness />);
    const biaCostCellButton = screen.getByRole('button', { name: /\/h/i });
    await user.click(biaCostCellButton);
    await screen.findByText('Override coût d’indisponibilité');
    const overrideAmountInput = screen.getByRole('spinbutton');
    fireEvent.change(overrideAmountInput, { target: { value: '5200' } });
    await user.click(screen.getByRole('button', { name: /Sauvegarder/i }));
    await waitFor(() => {
      expect(upsertFinancialOverrideSpy).toHaveBeenCalledWith(
        'node-1',
        expect.objectContaining({ customCostPerHour: 5200 }),
      );
    });
    biaRender.unmount();

    let runbooksState: any[] = [];

    const baseRunbook = {
      id: 'rb-qa-1',
      title: 'Runbook payment region failover',
      description: 'Recovery playbook generated from simulation.',
      summary: 'Recovery playbook generated from simulation.',
      status: 'draft',
      simulationId: 'sim-1',
      recommendationId: null,
      responsible: 'SRE',
      accountable: 'CTO',
      consulted: 'SecOps',
      informed: 'Business Owner',
      lastTestedAt: null,
      testResult: null,
      generatedAt: '2026-02-16T10:00:00.000Z',
      updatedAt: '2026-02-16T10:00:00.000Z',
      steps: [
        { order: 1, title: 'Detection', description: 'Detect', type: 'manual', estimatedDurationMinutes: 10, assignedRole: 'NOC', commands: ['kubectl get pods -A'] },
        { order: 2, title: 'Evaluation', description: 'Evaluate', type: 'decision', estimatedDurationMinutes: 12, assignedRole: 'IM', commands: ['aws cloudwatch get-metric-data'] },
        { order: 3, title: 'Communication', description: 'Communicate', type: 'notification', estimatedDurationMinutes: 8, assignedRole: 'Comms', commands: ['echo notice'] },
        { order: 4, title: 'Recovery', description: 'Recover', type: 'automated', estimatedDurationMinutes: 25, assignedRole: 'DBA', commands: ['aws rds failover-db-cluster --db-cluster-identifier db-primary'] },
        { order: 5, title: 'Verification', description: 'Verify', type: 'manual', estimatedDurationMinutes: 15, assignedRole: 'QA', commands: ['npm run smoke:test'] },
        { order: 6, title: 'Post-mortem', description: 'Post', type: 'manual', estimatedDurationMinutes: 20, assignedRole: 'IM', commands: ['echo post-mortem > report.md'] },
      ],
    };

    vi.mocked(simulationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'sim-1',
          name: 'Region failover dry-run',
          scenarioType: 'region-outage',
          status: 'completed',
        },
      ] as any),
    );

    vi.mocked(runbooksApi.getAll).mockImplementation(async () => asApiResult(runbooksState as any));
    vi.mocked(runbooksApi.generate).mockImplementation(async () => {
      runbooksState = [{ ...baseRunbook }];
      return asApiResult({ runbook: runbooksState[0] } as any);
    });
    vi.mocked(runbooksApi.getById).mockImplementation(async () => asApiResult(runbooksState[0] as any));
    vi.mocked(runbooksApi.validate).mockImplementation(async () => {
      runbooksState = runbooksState.map((runbook) => ({
        ...runbook,
        status: 'validated',
        updatedAt: '2026-02-16T10:10:00.000Z',
      }));
      return asApiResult(runbooksState[0] as any);
    });
    vi.mocked(runbooksApi.update).mockImplementation(async (_id, payload: any) => {
      runbooksState = runbooksState.map((runbook) => ({
        ...runbook,
        ...payload,
        updatedAt: '2026-02-16T10:20:00.000Z',
      }));
      return asApiResult(runbooksState[0] as any);
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={['/simulations/runbooks']}>
          <Routes>
            <Route path="/simulations/runbooks" element={<RunbooksPage />} />
            <Route path="/simulations/runbooks/:id" element={<RunbookDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('Runbooks operationnels');
    const simulationSelect = screen.getByRole('combobox');
    await user.selectOptions(simulationSelect, 'sim-1');
    await user.click(screen.getByRole('button', { name: /Generer depuis une simulation/i }));

    await screen.findByText('Runbook payment region failover');
    expect(screen.queryByRole('button', { name: /^Activer$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Valider$/i }));
    await screen.findByText('validated');

    await user.click(screen.getByRole('button', { name: /Marquer comme teste/i }));
    await screen.findByText('tested');

    await user.click(screen.getByRole('button', { name: /^Activer$/i }));
    await screen.findByText('active');

    if (originalCreateObjectURL) {
      (URL as any).createObjectURL = originalCreateObjectURL;
    } else {
      delete (URL as any).createObjectURL;
    }

    if (originalRevokeObjectURL) {
      (URL as any).revokeObjectURL = originalRevokeObjectURL;
    } else {
      delete (URL as any).revokeObjectURL;
    }

    anchorClickSpy.mockRestore();
  });
});
