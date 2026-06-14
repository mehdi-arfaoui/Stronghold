import { describe, expect, it } from 'vitest';

import {
  DurationParseError,
  formatDuration,
  parseDuration,
  tryParseDuration,
} from './duration-parser.js';

describe('parseDuration', () => {
  describe('valid formats', () => {
    it('parses hours only: "1h" -> 3600000ms', () => {
      expect(parseDuration('1h')).toEqual({
        raw: '1h',
        totalMs: 3_600_000,
        hours: 1,
        minutes: 0,
        seconds: 0,
      });
    });

    it('parses minutes only: "30m" -> 1800000ms', () => {
      expect(parseDuration('30m')).toMatchObject({
        raw: '30m',
        totalMs: 1_800_000,
        hours: 0,
        minutes: 30,
        seconds: 0,
      });
    });

    it('parses seconds only: "45s" -> 45000ms', () => {
      expect(parseDuration('45s')).toMatchObject({
        raw: '45s',
        totalMs: 45_000,
        hours: 0,
        minutes: 0,
        seconds: 45,
      });
    });

    it('parses hours + minutes: "1h30m" -> 5400000ms', () => {
      expect(parseDuration('1h30m')).toMatchObject({
        raw: '1h30m',
        totalMs: 5_400_000,
        hours: 1,
        minutes: 30,
        seconds: 0,
      });
    });

    it('parses hours + minutes + seconds: "2h15m30s" -> 8130000ms', () => {
      expect(parseDuration('2h15m30s')).toMatchObject({
        raw: '2h15m30s',
        totalMs: 8_130_000,
        hours: 2,
        minutes: 15,
        seconds: 30,
      });
    });

    it('parses large values: "90m" -> 5400000ms', () => {
      expect(parseDuration('90m')).toMatchObject({
        raw: '90m',
        totalMs: 5_400_000,
        hours: 0,
        minutes: 90,
        seconds: 0,
      });
    });

    it('parses large hours: "24h" -> 86400000ms', () => {
      expect(parseDuration('24h').totalMs).toBe(86_400_000);
    });

    it('parses single digit: "5m" -> 300000ms', () => {
      expect(parseDuration('5m').totalMs).toBe(300_000);
    });
  });

  describe('invalid formats', () => {
    it('rejects empty string', () => {
      expect(() => parseDuration('')).toThrow(DurationParseError);
    });

    it('rejects number without unit: "30"', () => {
      expect(() => parseDuration('30')).toThrow(DurationParseError);
    });

    it('rejects days: "1d"', () => {
      expect(() => parseDuration('1d')).toThrow(DurationParseError);
    });

    it('rejects decimals: "1.5h"', () => {
      expect(() => parseDuration('1.5h')).toThrow(DurationParseError);
    });

    it('rejects negative: "-1h"', () => {
      expect(() => parseDuration('-1h')).toThrow(DurationParseError);
    });

    it('rejects zero: "0h"', () => {
      expect(() => parseDuration('0h')).toThrow(DurationParseError);
    });

    it('rejects zero minutes: "0m"', () => {
      expect(() => parseDuration('0m')).toThrow(DurationParseError);
    });

    it('rejects zero component: "1h0m"', () => {
      expect(() => parseDuration('1h0m')).toThrow(DurationParseError);
    });

    it('rejects leading zero: "01h"', () => {
      expect(() => parseDuration('01h')).toThrow(DurationParseError);
    });

    it('rejects ISO 8601: "P1H"', () => {
      expect(() => parseDuration('P1H')).toThrow(DurationParseError);
    });

    it('rejects ISO 8601: "PT1H30M"', () => {
      expect(() => parseDuration('PT1H30M')).toThrow(DurationParseError);
    });

    it('rejects random text: "abc"', () => {
      expect(() => parseDuration('abc')).toThrow(DurationParseError);
    });

    it('rejects mixed invalid: "1h abc"', () => {
      expect(() => parseDuration('1h abc')).toThrow(DurationParseError);
    });

    it('rejects duplicate units: "1h2h"', () => {
      expect(() => parseDuration('1h2h')).toThrow(DurationParseError);
    });

    it('rejects spaces: "1h 30m"', () => {
      expect(() => parseDuration('1h 30m')).toThrow(DurationParseError);
    });
  });

  describe('roundtrip', () => {
    it('formatDuration(parseDuration("1h30m")) === "1h30m"', () => {
      expect(formatDuration(parseDuration('1h30m'))).toBe('1h30m');
    });

    it('formatDuration(parseDuration("45s")) === "45s"', () => {
      expect(formatDuration(parseDuration('45s'))).toBe('45s');
    });

    it('parseDuration(formatDuration(x)).totalMs === x.totalMs', () => {
      const parsed = parseDuration('2h15m30s');
      expect(parseDuration(formatDuration(parsed)).totalMs).toBe(parsed.totalMs);
    });

    it('rejects formatting a zero duration object', () => {
      expect(() =>
        formatDuration({
          raw: '0s',
          totalMs: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
        }),
      ).toThrow(DurationParseError);
    });
  });
});

describe('tryParseDuration', () => {
  it('returns ParsedDuration for valid input', () => {
    expect(tryParseDuration('5m')?.totalMs).toBe(300_000);
  });

  it('returns null for invalid input', () => {
    expect(tryParseDuration('1d')).toBeNull();
  });
});
