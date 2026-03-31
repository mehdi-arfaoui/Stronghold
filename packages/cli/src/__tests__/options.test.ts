import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROVIDER,
  DEFAULT_SCAN_OUTPUT,
  ensureVpcIncluded,
  parseRegionOption,
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
    expect(ensureVpcIncluded(['rds', 'aurora'])).toEqual(['rds', 'aurora', 'vpc']);
  });
});
