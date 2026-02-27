import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RecommendationsEngine } from './RecommendationsEngine';
import { recommendationsApi } from '@/api/recommendations.api';
import { financialApi } from '@/api/financial.api';

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

function asApiResult<T>(data: T): Promise<{ data: T }> {
  return Promise.resolve({ data });
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
      } as any),
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
      ] as any),
    );

    vi.mocked(recommendationsApi.getSummary).mockImplementation(async () =>
      asApiResult({
        totalAnnualCost: 3600,
        totalRecommendations: 3,
        riskAvoidedAnnual: 15000,
        roiPercent: 316.6,
        paybackMonths: 2.9,
      } as any),
    );

    vi.mocked(financialApi.calculateROI).mockImplementation(async () =>
      asApiResult({
        annualRemediationCost: 3600,
        riskReductionAmount: 15000,
        roiPercent: 316.6,
        paybackMonths: 2.9,
        breakdownByRecommendation: [
          {
            recommendationId: 'rec-managed',
            annualCost: 0,
            riskReduction: 0,
            individualROI: 0,
            paybackMonths: null,
            paybackLabel: 'Non rentable',
            roiStatus: 'non_applicable',
          },
          {
            recommendationId: 'rec-top',
            annualCost: 2400,
            riskReduction: 9600,
            individualROI: 300,
            paybackMonths: null,
            paybackLabel: 'Non rentable',
            roiStatus: 'rentable',
          },
          {
            recommendationId: 'rec-second',
            annualCost: 1200,
            riskReduction: 5400,
            individualROI: 350,
            paybackMonths: null,
            paybackLabel: 'Non rentable',
            roiStatus: 'rentable',
          },
        ],
      } as any),
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
