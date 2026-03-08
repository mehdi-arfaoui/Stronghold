import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { RecommendationsEngine } from './RecommendationsEngine';
import { recommendationsApi } from '@/api/recommendations.api';
import { financialApi } from '@/api/financial.api';
import type { FinancialROIResult, OrganizationFinancialProfile } from '@/api/financial.api';
import type { Recommendation, RecommendationsSummary } from '@/api/recommendations.api';
import { useAuth } from '@/hooks/useAuth';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
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

vi.mock('@/api/financial.api', () => ({
  financialApi: {
    getOrgProfile: vi.fn(),
    calculateROI: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

function asApiResult<T>(data: T): Promise<AxiosResponse<T>> {
  return Promise.resolve({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} } as InternalAxiosRequestConfig,
  });
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderRecommendationsEngine() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <RecommendationsEngine />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('RecommendationsEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
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
    });

    vi.mocked(financialApi.getOrgProfile).mockImplementation(async () =>
      asApiResult({
        customCurrency: 'EUR',
        isConfigured: true,
      } as OrganizationFinancialProfile),
    );

    vi.mocked(recommendationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'rec-managed',
          serviceName: 'Managed Session Store',
          description: 'Service manage sans cout DR additionnel.',
          tier: 1,
          recommendationBand: 'secondary',
          costCountedInSummary: false,
          strategy: 'backup-restore',
          estimatedCost: 0,
          estimatedAnnualCost: 0,
          priority: 'P1',
          costSource: 'static-table',
          costSourceLabel: 'Table statique',
        },
        {
          id: 'rec-top',
          serviceName: 'Payment API',
          description: 'Ajoute un warm standby multi-region.',
          tier: 2,
          strategy: 'warm-standby',
          estimatedCost: 200,
          estimatedAnnualCost: 2400,
          priority: 'P1',
          costSource: 'pricing-api',
          roi: 300,
          paybackLabel: 'Non rentable',
          calculation: {
            aleCurrent: 12000,
            aleAfter: 2400,
            riskAvoidedAnnual: 9600,
            annualDrCost: 2400,
            formula: 'test',
            inputs: {
              hourlyDowntimeCost: 1000,
              currentRtoHours: 2,
              targetRtoHours: 0.5,
              incidentProbabilityAnnual: 0.2,
              monthlyDrCost: 200,
            },
          },
        },
        {
          id: 'rec-second',
          serviceName: 'Order DB',
          description: 'Replica de lecture avec failover automatise.',
          tier: 1,
          strategy: 'pilot-light',
          estimatedCost: 100,
          estimatedAnnualCost: 1200,
          priority: 'P2',
          costSource: 'pricing-api',
          roi: 40,
          calculation: {
            aleCurrent: 6600,
            aleAfter: 4920,
            riskAvoidedAnnual: 1680,
            annualDrCost: 1200,
            formula: 'test',
            inputs: {
              hourlyDowntimeCost: 500,
              currentRtoHours: 3,
              targetRtoHours: 2.2,
              incidentProbabilityAnnual: 0.2,
              monthlyDrCost: 100,
            },
          },
        },
      ] as Recommendation[]),
    );

    vi.mocked(recommendationsApi.getSummary).mockImplementation(async () =>
      asApiResult({
        totalAnnualCost: 3600,
        totalRecommendations: 2,
        secondaryRecommendations: 1,
        secondaryAnnualCost: 0,
        annualCostCap: 7700,
        annualCostByStrategy: {
          warm_standby: 2400,
          pilot_light: 1200,
        },
        costSharePercentByStrategy: {
          warm_standby: 67,
          pilot_light: 33,
        },
        riskAvoidedAnnual: 11280,
        roiPercent: 213.3,
        paybackMonths: 3.8,
        financialProfileConfigured: true,
      } as RecommendationsSummary),
    );

    vi.mocked(financialApi.calculateROI).mockImplementation(async () =>
      asApiResult({
        currentALE: 18000,
        projectedALE: 6720,
        riskReduction: 0.626,
        annualRemediationCost: 3600,
        riskReductionAmount: 11280,
        netAnnualSavings: 7680,
        roiPercent: 213.3,
        paybackMonths: 3.8,
        strongholdSubscriptionAnnual: 0,
        breakdownByRecommendation: [
          {
            recommendationId: 'rec-managed',
            strategy: 'backup-restore',
            targetNodes: ['rec-managed'],
            annualCost: 0,
            currentALE: 0,
            projectedALE: 0,
            riskReduction: 0,
            individualROI: 0,
            paybackMonths: null,
            paybackLabel: 'Non rentable',
            roiStatus: 'non_applicable',
          },
          {
            recommendationId: 'rec-top',
            strategy: 'warm-standby',
            targetNodes: ['rec-top'],
            annualCost: 2400,
            currentALE: 12000,
            projectedALE: 2400,
            riskReduction: 9600,
            individualROI: 300,
            paybackMonths: null,
            paybackLabel: 'Non rentable',
            roiStatus: 'rentable',
          },
          {
            recommendationId: 'rec-second',
            strategy: 'pilot-light',
            targetNodes: ['rec-second'],
            annualCost: 1200,
            currentALE: 6600,
            projectedALE: 4920,
            riskReduction: 1680,
            individualROI: 40,
            paybackMonths: 8.57,
            paybackLabel: 'Rentable a moyen terme',
            roiStatus: 'rentable',
          },
        ],
        methodology: 'test-method',
        sources: ['test'],
        disclaimer: 'test-disclaimer',
        currency: 'EUR',
        calculatedAt: new Date().toISOString(),
      } as FinancialROIResult),
    );

    vi.mocked(recommendationsApi.regenerate).mockImplementation(async () =>
      asApiResult({
        success: true,
        summary: {
          totalNodes: 12,
          recommendationsGenerated: 3,
          resilientByDesign: 7,
          noRuleApplicable: 2,
          requiresVerification: 1,
          totalDrCostMonthly: 300,
          totalDrCostAnnual: 3600,
          financialProfileConfigured: true,
          durationMs: 65_000,
        },
      }),
    );
  });

  it('applique filtres/tri et affiche quick wins avec labels pricing nettoyes', async () => {
    const user = userEvent.setup();

    renderRecommendationsEngine();

    await screen.findByText(/Quick Wins & forte valeur ajout/i);
    expect(screen.getByText('Autres recommandations (2)')).toBeInTheDocument();
    expect(
      screen.getByText(/3 recommandations affich.*3 total.*1 Quick Wins/i),
    ).toBeInTheDocument();

    const quickWinSection = screen
      .getByText(/Quick Wins & forte valeur ajout/i)
      .closest('section') as HTMLElement;
    expect(within(quickWinSection).getByText('Payment API')).toBeInTheDocument();
    expect(within(quickWinSection).getByText('Quick Win')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Strat.*DR : Toutes/i }));
    await user.click(screen.getByRole('button', { name: 'Aucune' }));
    await user.click(screen.getByText('Warm Standby'));

    expect(
      await screen.findByText(/1 recommandations affich.*3 total.*1 Quick Wins/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Payment API')).toBeInTheDocument();
    expect(screen.queryByText('Order DB')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /R.*initialiser les filtres/i }));
    expect(
      await screen.findByText(/3 recommandations affich.*3 total.*1 Quick Wins/i),
    ).toBeInTheDocument();

    const maxCostInput = screen.getByLabelText(/Co.*t estim/i);
    await user.clear(maxCostInput);
    await user.type(maxCostInput, '1500');
    await user.click(screen.getByRole('button', { name: /Trier par ROI croissant/i }));

    expect(
      await screen.findByText(/2 recommandations affich.*3 total.*0 Quick Wins/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Payment API')).not.toBeInTheDocument();

    const managedCard = screen.getByText('Managed Session Store').closest('[class*="border"]') as HTMLElement;
    expect(within(managedCard).getByText(/Inclus dans le service manag/i)).toBeInTheDocument();
    expect(within(managedCard).queryByText('Hors cap DR')).not.toBeInTheDocument();
    expect(within(managedCard).queryByText(/Payback:/i)).not.toBeInTheDocument();

    expect(screen.queryByText(/Estimation\s*[≈~]/i)).not.toBeInTheDocument();
  }, 10000);
  it('masque ROI/economie/quick-win quand le profil financier est non configure', async () => {
    vi.mocked(financialApi.getOrgProfile).mockImplementation(async () =>
      asApiResult({
        customCurrency: 'EUR',
        isConfigured: false,
      } as OrganizationFinancialProfile),
    );

    vi.mocked(recommendationsApi.getAll).mockImplementation(async () =>
      asApiResult([
        {
          id: 'rec-infra-only',
          serviceName: 'payment-api',
          description: 'Ajoute un warm standby multi-region.',
          tier: 1,
          strategy: 'warm-standby',
          estimatedCost: 200,
          estimatedAnnualCost: 2400,
          priority: 'P1',
          roi: 733,
          paybackMonths: 0.8,
          roiReliable: false,
        },
      ] as Recommendation[]),
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
        selectedAnnualCost: 0,
        remainingBudgetAnnual: 7700,
        financialProfileConfigured: false,
      } as RecommendationsSummary),
    );

    renderRecommendationsEngine();

    const cardTitle = await screen.findByText(/API Payment|payment-api/i);
    const card = cardTitle.closest('[class*="border"]') as HTMLElement;

    expect(screen.queryByText(/Quick Wins/i)).not.toBeInTheDocument();
    expect(within(card).queryByText('Quick Win')).not.toBeInTheDocument();
    expect(within(card).queryByText(/Payback:/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Economie annuelle/i)).not.toBeInTheDocument();
    expect(within(card).getByText(/Configurez votre profil financier pour voir le ROI\./i)).toBeInTheDocument();
    const ctaLinks = within(card).getAllByRole('link', { name: /Configurer le profil financier/i });
    expect(ctaLinks.length).toBeGreaterThan(0);
    expect(ctaLinks[0]).toHaveAttribute('href', '/settings?tab=finance');

    expect(screen.getByText(/Profil financier non configure - ROI non disponible/i)).toBeInTheDocument();
    expect(financialApi.calculateROI).not.toHaveBeenCalled();
  });

  it('affiche le flux de régénération pour un admin', async () => {
    const user = userEvent.setup();
    renderRecommendationsEngine();

    const toolbarButton = await screen.findByRole('button', { name: 'Recalculer' });
    await user.click(toolbarButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Supprimer toutes les recommandations existantes/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Recalculer' }));

    await waitFor(() => {
      expect(recommendationsApi.regenerate).toHaveBeenCalledTimes(1);
    });
  });

  it('masque le bouton de régénération pour un utilisateur non admin', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'analyst-user',
        tenantId: 'tenant-1',
        email: 'analyst@stronghold.local',
        displayName: 'Analyst',
        role: 'ANALYST',
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
    });

    renderRecommendationsEngine();
    expect(screen.queryByRole('button', { name: 'Recalculer' })).not.toBeInTheDocument();
  });
});
