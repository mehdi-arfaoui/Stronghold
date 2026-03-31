import { createHash, createHmac } from 'node:crypto';
import https from 'node:https';

import type { ActionConfig } from './config';

const CREDENTIAL_TIMEOUT_MS = 30_000;
const STS_QUERY = 'Action=GetCallerIdentity&Version=2011-06-15';

export class CredentialsValidationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'CredentialsValidationError';
  }
}

/** Validate AWS credentials with a signed STS GetCallerIdentity request. */
export async function validateCredentials(config: ActionConfig): Promise<void> {
  const region = config.regions[0];
  if (!region) {
    throw new CredentialsValidationError(
      'At least one AWS region is required to validate credentials.',
    );
  }

  const host = `sts.${region}.amazonaws.com`;
  const amzDate = formatAmzDate(new Date());
  const dateStamp = amzDate.slice(0, 8);
  const headers = buildSignedHeaders(config, host, amzDate);
  const signedHeaders = Object.keys(headers).sort().join(';');
  const credentialScope = `${dateStamp}/${region}/sts/aws4_request`;
  const canonicalRequest = buildCanonicalRequest(headers, signedHeaders);
  const stringToSign = buildStringToSign(amzDate, credentialScope, canonicalRequest);
  const signature = hmacHex(
    getSigningKey(config.awsSecretAccessKey, dateStamp, region, 'sts'),
    stringToSign,
  );

  try {
    await performHttpsRequest(host, {
      ...headers,
      authorization: buildAuthorizationHeader(
        config.awsAccessKeyId,
        credentialScope,
        signedHeaders,
        signature,
      ),
    });
  } catch (error) {
    throw new CredentialsValidationError(
      'Signed STS validation request failed.',
      error,
    );
  }
}

function buildCanonicalRequest(
  headers: Record<string, string>,
  signedHeaders: string,
): string {
  const canonicalHeaders = Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}\n`)
    .join('');
  return ['GET', '/', STS_QUERY, canonicalHeaders, signedHeaders, sha256('')].join('\n');
}

function buildStringToSign(
  amzDate: string,
  credentialScope: string,
  canonicalRequest: string,
): string {
  return [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');
}

function buildSignedHeaders(
  config: ActionConfig,
  host: string,
  amzDate: string,
): Record<string, string> {
  return {
    host,
    'x-amz-date': amzDate,
    ...(config.awsSessionToken ? { 'x-amz-security-token': config.awsSessionToken } : {}),
  };
}

function buildAuthorizationHeader(
  accessKeyId: string,
  credentialScope: string,
  signedHeaders: string,
  signature: string,
): string {
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function performHttpsRequest(
  host: string,
  headers: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      { method: 'GET', host, path: `/?${STS_QUERY}`, headers },
      (response) => {
        response.resume();
        response.on('end', () => {
          if ((response.statusCode ?? 500) < 300) {
            resolve();
            return;
          }
          reject(
            new CredentialsValidationError('STS rejected the supplied AWS credentials.'),
          );
        });
      },
    );

    request.setTimeout(CREDENTIAL_TIMEOUT_MS, () => {
      request.destroy(
        new CredentialsValidationError('AWS credential validation timed out.'),
      );
    });
    request.on('error', (error) => reject(error));
    request.end();
  });
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function getSigningKey(
  secretAccessKey: string,
  date: string,
  region: string,
  service: string,
): Buffer {
  const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, date);
  const regionKey = hmacBuffer(dateKey, region);
  const serviceKey = hmacBuffer(regionKey, service);
  return hmacBuffer(serviceKey, 'aws4_request');
}

function hmacBuffer(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
