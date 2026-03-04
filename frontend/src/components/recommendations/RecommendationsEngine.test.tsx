import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { RecommendationsEngine } from './RecommendationsEngine';
import { recommendationsApi } from '@/api/recommendations.api';
import { financialApi } from '@/api/financial.api';
import type { FinancialROIResult, OrganizationFinancialProfile } from '@/api/financial.api';
import type { Recommendation, RecommendationsSummary } from '@/api/recommendations.api';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/api/recommendations.api', () => ({
  recommendationsApi: {
    getAll: vi.fn(),
    getSummary: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock('@/api/financial.api', () => ({
  financialApi: {
    getOrgProfile: vi.fn(),
    calculateROI: vi.fn(),
  },
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

describe('RecommendationsEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
          costSourceLabel: '[Estimation ≈]',
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
  });

  it('hierarchise les quick wins et applique les filtres/sorts', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <RecommendationsEngine />
      </QueryClientProvider>,
    );

    await screen.findByText('Quick Wins & forte valeur ajoutée (1)');
    expect(screen.getByText('Autres recommandations (2)')).toBeInTheDocument();
    expect(screen.getByText('3 recommandations affichées sur 3 total (dont 1 Quick Wins)')).toBeInTheDocument();
    expect(screen.queryByText(/Source cout:/i)).not.toBeInTheDocument();

    const quickWinSection = screen.getByText('Quick Wins & forte valeur ajoutée (1)').closest('section') as HTMLElement;
    expect(within(quickWinSection).getByText('Payment API')).toBeInTheDocument();
    expect(within(quickWinSection).getByText('⚡ Quick Win')).toBeInTheDocument();
    expect(within(quickWinSection).getByText(/3,0 mois/i)).toBeInTheDocument();

    const otherSection = screen.getByText('Autres recommandations (2)').closest('section') as HTMLElement;
    expect(within(otherSection).getByText('Order DB')).toBeInTheDocument();
    expect(within(otherSection).getByText('Managed Session Store')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Stratégie DR : Toutes/i }));
    await user.click(screen.getByRole('button', { name: 'Aucune' }));
    await user.click(screen.getByText('Warm Standby'));

    expect(await screen.findByText('1 recommandations affichées sur 3 total (dont 1 Quick Wins)')).toBeInTheDocument();
    expect(screen.getByText('Payment API')).toBeInTheDocument();
    expect(screen.queryByText('Order DB')).not.toBeInTheDocument();
    expect(screen.queryByText('Managed Session Store')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Réinitialiser les filtres/i }));
    expect(await screen.findByText('3 recommandations affichées sur 3 total (dont 1 Quick Wins)')).toBeInTheDocument();

    const maxCostInput = screen.getByLabelText('Coût estimé');
    await user.clear(maxCostInput);
    await user.type(maxCostInput, '1500');
    await user.click(screen.getByRole('button', { name: /Trier par ROI croissant/i }));

    expect(await screen.findByText('2 recommandations affichées sur 3 total (dont 0 Quick Wins)')).toBeInTheDocument();
    expect(screen.queryByText('Payment API')).not.toBeInTheDocument();
    expect(screen.getByText('Quick Wins & forte valeur ajoutée (0)')).toBeInTheDocument();

    const managedCard = screen.getByText('Managed Session Store').closest('[class*="border"]') as HTMLElement;
    expect(within(managedCard).getByText('Inclus dans le service managé')).toBeInTheDocument();
    expect(within(managedCard).getByText('Hors cap DR')).toBeInTheDocument();
    expect(within(managedCard).queryByText(/Payback:/i)).not.toBeInTheDocument();

    const managedLabel = screen.getByText('Managed Session Store');
    const orderLabel = screen.getByText('Order DB');
    const relation = managedLabel.compareDocumentPosition(orderLabel);
    expect(Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  }, 10000);
});
