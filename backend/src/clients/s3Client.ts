import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { S3Client, CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

if (credentials) {
  s3Config.credentials = credentials;
}

export const s3Client = new S3Client(s3Config);

const DEFAULT_SIGNED_URL_TTL = Number(process.env.S3_SIGNED_URL_TTL_SECONDS || 900);

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

export async function ensureBucketExists(bucket: string) {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
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
    return {
      bucket: bucket || getTenantBucketName(tenantId),
      key: key || extractObjectKey(storagePath, storedName),
    };
  }

  return {
    bucket: getTenantBucketName(tenantId),
    key: extractObjectKey(storagePath, storedName),
  };
}

export async function uploadObjectToBucket(params: {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
}) {
  await ensureBucketExists(params.bucket);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ContentLength: params.body.byteLength,
    })
  );
}

export async function getSignedUrlForObject(bucket: string, key: string, ttlSeconds?: number) {
  const expiresIn = Math.max(60, Math.min(ttlSeconds || DEFAULT_SIGNED_URL_TTL, 60 * 60 * 24 * 7));
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function downloadObjectToTempFile(
  bucket: string,
  key: string,
  preferredName?: string
): Promise<string> {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
