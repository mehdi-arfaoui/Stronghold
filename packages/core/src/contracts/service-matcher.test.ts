import { describe, expect, it } from 'vitest';

import { filterServicesByPattern, matchesServicePattern } from './service-matcher.js';

describe('matchesServicePattern', () => {
  describe('exact match', () => {
    it('"payment-processing" matches "payment-processing"', () => {
      expect(matchesServicePattern('payment-processing', 'payment-processing')).toBe(true);
    });

    it('"payment-processing" does NOT match "payment-proc"', () => {
      expect(matchesServicePattern('payment-processing', 'payment-proc')).toBe(false);
    });

    it('match is case-sensitive', () => {
      expect(matchesServicePattern('Payment-Processing', 'payment-processing')).toBe(false);
    });
  });

  describe('wildcard *', () => {
    it('"*" matches any service', () => {
      expect(matchesServicePattern('payment-processing', '*')).toBe(true);
    });

    it('"payment-*" matches "payment-processing"', () => {
      expect(matchesServicePattern('payment-processing', 'payment-*')).toBe(true);
    });

    it('"payment-*" matches "payment-api"', () => {
      expect(matchesServicePattern('payment-api', 'payment-*')).toBe(true);
    });

    it('"payment-*" does NOT match "checkout-processing"', () => {
      expect(matchesServicePattern('checkout-processing', 'payment-*')).toBe(false);
    });

    it('"*-service" matches "auth-service"', () => {
      expect(matchesServicePattern('auth-service', '*-service')).toBe(true);
    });

    it('"*-service" does NOT match "auth-handler"', () => {
      expect(matchesServicePattern('auth-handler', '*-service')).toBe(false);
    });

    it('"pay*ment" matches "payment"', () => {
      expect(matchesServicePattern('payment', 'pay*ment')).toBe(true);
    });

    it('"pay*ment" matches "pay-something-ment"', () => {
      expect(matchesServicePattern('pay-something-ment', 'pay*ment')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('empty pattern matches nothing', () => {
      expect(matchesServicePattern('payment-processing', '')).toBe(false);
    });

    it('"*" matches empty service name', () => {
      expect(matchesServicePattern('', '*')).toBe(true);
    });

    it('pattern with special regex chars is escaped: "payment.service"', () => {
      expect(matchesServicePattern('payment.service', 'payment.service')).toBe(true);
      expect(matchesServicePattern('payment-service', 'payment.service')).toBe(false);
    });

    it('unsupported ? wildcard is treated literally', () => {
      expect(matchesServicePattern('payment-api', 'payment-?pi')).toBe(false);
      expect(matchesServicePattern('payment-?pi', 'payment-?pi')).toBe(true);
    });
  });
});

describe('filterServicesByPattern', () => {
  it('filters a list of services by pattern', () => {
    const services = ['payment-api', 'payment-worker', 'auth-service', 'checkout'];
    expect(filterServicesByPattern(services, 'payment-*')).toEqual([
      'payment-api',
      'payment-worker',
    ]);
  });

  it('"*" returns all services', () => {
    const services = ['payment-api', 'auth-service'];
    expect(filterServicesByPattern(services, '*')).toEqual(services);
  });

  it('no matches returns empty array', () => {
    expect(filterServicesByPattern(['payment-api'], 'auth-*')).toEqual([]);
  });
});
