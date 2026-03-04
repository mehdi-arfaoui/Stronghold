import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BIATable } from '@/components/bia/BIATable';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { BIAEntry } from '@/types/bia.types';

function createEntry(overrides: Partial<BIAEntry> = {}): BIAEntry {
  return {
    id: overrides.id || 'bia-1',
    nodeId: overrides.nodeId || 'node-1',
    serviceName: overrides.serviceName || 'payment-service',
    serviceType: overrides.serviceType || 'APPLICATION',
    tier: overrides.tier ?? 1,
    rto: overrides.rto ?? 120,
    rpo: overrides.rpo ?? 30,
    mtpd: overrides.mtpd ?? 480,
    rtoSuggested: overrides.rtoSuggested ?? 120,
    rpoSuggested: overrides.rpoSuggested ?? 30,
    mtpdSuggested: overrides.mtpdSuggested ?? 480,
    validated: overrides.validated ?? true,
    downtimeCostPerHour: overrides.downtimeCostPerHour ?? 800,
    downtimeCostSourceLabel: overrides.downtimeCostSourceLabel ?? '8% - 0/11 impactés',
    blastRadius: overrides.blastRadius ?? {
      directDependents: 0,
      transitiveDependents: 0,
      totalServices: 12,
      impactedServices: [],
    },
    dependencies: overrides.dependencies ?? [],
    ...overrides,
  };
}

describe('BIATable', () => {
  it('keeps the cost cell focused on the amount and moves blast metadata out of it', () => {
    render(
      <TooltipProvider>
        <BIATable entries={[createEntry()]} currency="EUR" />
      </TooltipProvider>,
    );

    const row = screen.getByText('payment-service').closest('tr');
    expect(row).not.toBeNull();

    const cells = within(row as HTMLTableRowElement).getAllByRole('cell');
    const blastCell = cells[6];
    const costCell = cells[7];
    const sourceCell = cells[8];

    expect(blastCell).toHaveTextContent('8% - 0/11 impactés');
    expect(blastCell).toHaveTextContent('Blast radius');

    expect(costCell).toHaveTextContent(/800/);
    expect(costCell).toHaveTextContent(/\/h/);
    expect(costCell).not.toHaveTextContent('Blast radius');
    expect(costCell).not.toHaveTextContent('8% - 0/11 impactés');

    const costButton = within(costCell).getByRole('button');
    expect(costButton.className).toContain('whitespace-nowrap');

    expect(sourceCell).toHaveTextContent('Blast radius');
    expect(sourceCell).not.toHaveTextContent('8% - 0/11 impactés');
  });
});
