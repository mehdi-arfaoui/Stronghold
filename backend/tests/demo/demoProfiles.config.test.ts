import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveOrganizationSizeCategoryFromDemoProfile,
  resolveDemoProfileSelection,
} from '../../src/demo/config/demo-profiles.js';

test('resolveDemoProfileSelection returns matrix defaults when no overrides are provided', () => {
  const selection = resolveDemoProfileSelection({
    sector: 'finance',
    companySize: 'eti',
  });

  assert.equal(selection.financials.hourlyDowntimeCost, 200_000);
  assert.equal(selection.financials.annualRevenue, 500_000_000);
  assert.equal(selection.fieldSources.hourlyDowntimeCost, 'suggested');
  assert.equal(selection.hasUserOverrides, false);
});

test('resolveDemoProfileSelection keeps user overrides and marks only edited fields as user_input', () => {
  const selection = resolveDemoProfileSelection({
    sector: 'ecommerce',
    companySize: 'pme_plus',
    financialOverrides: {
      annualRevenue: 80_000_000,
      hourlyDowntimeCost: 27_500,
    },
  });

  assert.equal(selection.financials.annualRevenue, 80_000_000);
  assert.equal(selection.financials.hourlyDowntimeCost, 27_500);
  assert.equal(selection.fieldSources.annualRevenue, 'user_input');
  assert.equal(selection.fieldSources.hourlyDowntimeCost, 'user_input');
  assert.equal(selection.fieldSources.employeeCount, 'suggested');
  assert.equal(selection.hasUserOverrides, true);
});

test('deriveOrganizationSizeCategoryFromDemoProfile maps to stronghold size categories', () => {
  const largeSelection = resolveDemoProfileSelection({
    sector: 'public',
    companySize: 'large',
  });
  const smallSelection = resolveDemoProfileSelection({
    sector: 'it_saas',
    companySize: 'pme',
  });

  assert.equal(deriveOrganizationSizeCategoryFromDemoProfile(largeSelection), 'largeEnterprise');
  assert.equal(deriveOrganizationSizeCategoryFromDemoProfile(smallSelection), 'smb');
});
