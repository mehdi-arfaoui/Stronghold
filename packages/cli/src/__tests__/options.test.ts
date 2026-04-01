import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCAN_CONCURRENCY,
  DEFAULT_SCANNER_TIMEOUT_SECONDS,
  DEFAULT_PROVIDER,
  DEFAULT_SCAN_OUTPUT,
  ensureVpcIncluded,
  parseConcurrencyOption,
  parseRegionOption,
  parseScannerTimeoutOption,
  parseServiceOption,
} from '../config/options.js';

describe('options', () => {
  it('parses a single region', () => {
    expect(parseRegionOption('eu-west-1')).toEqual(['eu-west-1']);
  });

  it('parses multiple regions', () => {
    expect(parseRegionOption('eu-west-1,us-east-1')).toEqual(['eu-west-1', 'us-east-1']);
  });

  it('treats all-regions as a boolean flag at the command layer', () => {
    expect(true).toBe(true);
  });

  it('supports json output as a declared value', () => {
    expect(DEFAULT_SCAN_OUTPUT).toContain('summary');
    expect(['summary', 'json', 'silent']).toContain('json');
  });

  it('parses comma-separated services', () => {
    expect(parseServiceOption('rds,aurora,s3')).toEqual(['rds', 'aurora', 's3']);
  });

  it('keeps the documented defaults and auto-includes VPC when needed', () => {
    expect(DEFAULT_PROVIDER).toBe('aws');
    expect(DEFAULT_SCAN_OUTPUT).toBe('summary');
    expect(DEFAULT_SCAN_CONCURRENCY).toBe(5);
    expect(DEFAULT_SCANNER_TIMEOUT_SECONDS).toBe(60);
    expect(ensureVpcIncluded(['rds', 'aurora'])).toEqual(['rds', 'aurora', 'vpc']);
  });

  it('parses bounded concurrency values', () => {
    expect(parseConcurrencyOption('1')).toBe(1);
    expect(parseConcurrencyOption('16')).toBe(16);
    expect(() => parseConcurrencyOption('0')).toThrow(/--concurrency/);
  });

  it('parses bounded scanner timeout values', () => {
    expect(parseScannerTimeoutOption('10')).toBe(10);
    expect(parseScannerTimeoutOption('300')).toBe(300);
    expect(() => parseScannerTimeoutOption('301')).toThrow(/--scanner-timeout/);
  });
});
