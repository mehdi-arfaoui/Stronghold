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
          roi: 350,
          calculation: {
            aleCurrent: 6600,
            aleAfter: 1200,
            riskAvoidedAnnual: 5400,
            annualDrCost: 1200,
            formula: 'test',
            inputs: {
              hourlyDowntimeCost: 500,
              currentRtoHours: 3,
              targetRtoHours: 1,
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
        totalRecommendations: 3,
        riskAvoidedAnnual: 15000,
        roiPercent: 316.6,
        paybackMonths: 2.9,
      } as RecommendationsSummary),
    );

    vi.mocked(financialApi.calculateROI).mockImplementation(async () =>
      asApiResult({
        currentALE: 18000,
        projectedALE: 3000,
        riskReduction: 0.833,
        annualRemediationCost: 3600,
        riskReductionAmount: 15000,
        netAnnualSavings: 11400,
        roiPercent: 316.6,
        paybackMonths: 2.9,
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
            projectedALE: 1200,
            riskReduction: 5400,
            individualROI: 350,
            paybackMonths: null,
            paybackLabel: 'Non rentable',
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

  it('tri, sections et nettoyage payback/source sont conformes', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={createQueryClient()}>
        <RecommendationsEngine />
      </QueryClientProvider>,
    );

    await screen.findByText('Recommandations prioritaires (2)');
    expect(screen.getByText('Recommandations informatives (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Source cout:/i)).not.toBeInTheDocument();

    const topCard = screen.getByText('Payment API').closest('[class*="border"]') as HTMLElement;
    const secondCard = screen.getByText('Order DB').closest('[class*="border"]') as HTMLElement;
    expect(topCard && secondCard).toBeTruthy();
    if (topCard && secondCard) {
      const relation = topCard.compareDocumentPosition(secondCard);
      expect(Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      expect(within(topCard).getByText(/Payback:/i)).toBeInTheDocument();
      expect(within(topCard).getByText(/3.0 mois/i)).toBeInTheDocument();
    }

    await user.click(screen.getByText('Recommandations informatives (1)'));
    const managedCard = await screen.findByText('Managed Session Store');
    const managedContainer = managedCard.closest('[class*="border"]') as HTMLElement;
    expect(within(managedContainer).getByText('Inclus dans le service manage')).toBeInTheDocument();
    expect(within(managedContainer).queryByText(/Payback:/i)).not.toBeInTheDocument();
  });
});
