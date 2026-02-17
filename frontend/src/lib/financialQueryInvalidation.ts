import type { QueryClient } from '@tanstack/react-query';

export const FINANCIAL_PROFILE_DEPENDENT_QUERY_KEYS = [
  'financial-org-profile',
  'financial-summary',
  'financial-ale',
  'financial-roi',
  'financial-trend',
  'financial-flow-coverage',
  'business-flows-coverage',
  'flows-coverage',
  'bia-entries',
  'bia-summary',
  'financial-recommendations-roi',
] as const;

export async function invalidateFinancialProfileDependentQueries(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all(
    FINANCIAL_PROFILE_DEPENDENT_QUERY_KEYS.map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
