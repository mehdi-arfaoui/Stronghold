import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
const region = process.env.S3_REGION || "us-east-1";
const forcePathStyle =
  String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false";

const credentials: AwsCredentialIdentity | undefined =
  process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      }
    : undefined;

const s3Config: S3ClientConfig = {
  region,
  endpoint,
  forcePathStyle,
};

const sseAlgorithm = process.env.S3_SSE_ALGORITHM || process.env.S3_SERVER_SIDE_ENCRYPTION;
const sseKmsKeyId = process.env.S3_SSE_KMS_KEY_ID;

if (credentials) {
  s3Config.credentials = credentials;
}

let s3ClientPromise: Promise<S3Client> | null = null;
let s3SdkPromise: Promise<typeof import("@aws-sdk/client-s3")> | null = null;
let presignerPromise: Promise<typeof import("@aws-sdk/s3-request-presigner")> | null = null;

async function loadS3Sdk() {
  if (!s3SdkPromise) {
    s3SdkPromise = import("@aws-sdk/client-s3");
  }
  return s3SdkPromise;
}

async function loadPresigner() {
  if (!presignerPromise) {
    presignerPromise = import("@aws-sdk/s3-request-presigner");
  }
  return presignerPromise;
}

async function getS3Client() {
  if (!s3ClientPromise) {
    s3ClientPromise = loadS3Sdk().then((sdk) => new sdk.S3Client(s3Config));
  }
  return s3ClientPromise;
}

const DEFAULT_SIGNED_URL_TTL = Number(process.env.S3_SIGNED_URL_TTL_SECONDS || 900);

function resolveSignedUrlTtl(ttlSeconds?: number) {
  return Math.max(60, Math.min(ttlSeconds || DEFAULT_SIGNED_URL_TTL, 60 * 60 * 24 * 7));
}

function buildSseParams(): Record<string, string | undefined> {
  if (!sseAlgorithm) return {};
  return {
    ServerSideEncryption: sseAlgorithm,
    ...(sseAlgorithm === "aws:kms" && sseKmsKeyId ? { SSEKMSKeyId: sseKmsKeyId } : {}),
  };
}

function sanitizeTenantId(tenantId: string): string {
  const normalized = tenantId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function sanitizeBucketPrefix(prefix: string): string {
  const normalized = prefix.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const trimmed = normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return trimmed || "pra-docs";
}

export function getTenantBucketName(tenantId: string): string {
  const prefix = sanitizeBucketPrefix(process.env.S3_BUCKET_PREFIX || "pra-docs");
  const tenantPart = sanitizeTenantId(tenantId) || "tenant";
  const candidate = `${prefix}-${tenantPart}`;
  return candidate.slice(0, 63).replace(/-+$/g, "");
}

function assertTenantBucket(bucket: string, tenantId: string) {
  const expectedBucket = getTenantBucketName(tenantId);
  if (bucket !== expectedBucket) {
    throw new Error(`Bucket ${bucket} does not match tenant scope`);
  }
}

export async function ensureBucketExists(bucket: string) {
  const sdk = await loadS3Sdk();
  const s3Client = await getS3Client();
  try {
    await s3Client.send(new sdk.HeadBucketCommand({ Bucket: bucket }));
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      await s3Client.send(new sdk.CreateBucketCommand({ Bucket: bucket }));
    } else {
      throw err;
    }
  }
}

export function buildObjectKey(tenantId: string, originalName: string): string {
  const safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const tenant = sanitizeTenantId(tenantId) || "tenant";
  return `${tenant}/${uniquePrefix}-${safeName}`;
}

export function extractObjectKey(storagePath?: string | null, storedName?: string | null): string {
  const trimmed = (storagePath || "").trim();
  if (trimmed.startsWith("s3://")) {
    const withoutScheme = trimmed.slice("s3://".length);
    const [, ...keyParts] = withoutScheme.split("/");
    const key = keyParts.join("/");
    if (key) return key;
  }

  const normalized = trimmed.replace(/^\/+/, "");
  if (normalized) return normalized;
  if (storedName) return storedName;
  throw new Error("Unable to resolve object key from storagePath or storedName");
}

export function resolveBucketAndKey(
  storagePath: string | null | undefined,
  tenantId: string,
  storedName?: string | null
): { bucket: string; key: string } {
  const trimmed = (storagePath || "").trim();
  if (trimmed.startsWith("s3://")) {
    const withoutScheme = trimmed.slice("s3://".length);
    const [bucket, ...rest] = withoutScheme.split("/");
    const key = rest.join("/");
    const resolvedBucket = bucket || getTenantBucketName(tenantId);
    if (resolvedBucket) {
      assertTenantBucket(resolvedBucket, tenantId);
    }
    return {
      bucket: resolvedBucket || getTenantBucketName(tenantId),
      key: key || extractObjectKey(storagePath, storedName),
    };
  }

  const bucket = getTenantBucketName(tenantId);
  assertTenantBucket(bucket, tenantId);
  return {
    bucket,
    key: extractObjectKey(storagePath, storedName),
  };
}

export async function uploadObjectToBucket(params: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}) {
  const sdk = await loadS3Sdk();
  const s3Client = await getS3Client();
  await ensureBucketExists(params.bucket);
  await s3Client.send(
    new sdk.PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ContentLength: params.body.byteLength,
      ...buildSseParams(),
    })
  );
}

export async function uploadFileToBucket(params: {
  bucket: string;
  key: string;
  filePath: string;
  contentType?: string;
}) {
  const sdk = await loadS3Sdk();
  const s3Client = await getS3Client();
  await ensureBucketExists(params.bucket);
  const stats = await fs.promises.stat(params.filePath);
  await s3Client.send(
    new sdk.PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: fs.createReadStream(params.filePath),
      ContentType: params.contentType,
      ContentLength: stats.size,
      ...buildSseParams(),
    })
  );
}

export async function getSignedUrlForObject(bucket: string, key: string, ttlSeconds?: number) {
  const sdk = await loadS3Sdk();
  const { getSignedUrl } = await loadPresigner();
  const s3Client = await getS3Client();
  const expiresIn = resolveSignedUrlTtl(ttlSeconds);
  const command = new sdk.GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function getSignedUploadUrlForObject(
  bucket: string,
  key: string,
  contentType?: string,
  ttlSeconds?: number
): Promise<{ url: string; expiresIn: number }> {
  const sdk = await loadS3Sdk();
  const { getSignedUrl } = await loadPresigner();
  const s3Client = await getS3Client();
  const expiresIn = resolveSignedUrlTtl(ttlSeconds);
  const command = new sdk.PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...buildSseParams(),
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return { url, expiresIn };
}

export async function downloadObjectToTempFile(
  bucket: string,
  key: string,
  preferredName?: string
): Promise<string> {
  const sdk = await loadS3Sdk();
  const s3Client = await getS3Client();
  const response = await s3Client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error("Object stream is empty");
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stronghold-doc-"));
  const filename = preferredName || path.basename(key) || "object";
  const filePath = path.join(tmpDir, filename);

  const bodyStream = response.Body as Readable;
  await pipeline(bodyStream, fs.createWriteStream(filePath));

  return filePath;
}
