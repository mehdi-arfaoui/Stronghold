"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantBucketName = getTenantBucketName;
exports.ensureBucketExists = ensureBucketExists;
exports.buildObjectKey = buildObjectKey;
exports.extractObjectKey = extractObjectKey;
exports.resolveBucketAndKey = resolveBucketAndKey;
exports.uploadObjectToBucket = uploadObjectToBucket;
exports.getSignedUrlForObject = getSignedUrlForObject;
exports.downloadObjectToTempFile = downloadObjectToTempFile;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const promises_1 = require("stream/promises");
const stream_1 = require("stream");
const endpoint = process.env.S3_ENDPOINT || "http://localhost:9000";
const region = process.env.S3_REGION || "us-east-1";
const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false";
const credentials = process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    }
    : undefined;
const s3Config = {
    region,
    endpoint,
    forcePathStyle,
};
if (credentials) {
    s3Config.credentials = credentials;
}
let s3ClientPromise = null;
let s3SdkPromise = null;
let presignerPromise = null;
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
function sanitizeTenantId(tenantId) {
    const normalized = tenantId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}
function sanitizeBucketPrefix(prefix) {
    const normalized = prefix.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const trimmed = normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    return trimmed || "pra-docs";
}
function getTenantBucketName(tenantId) {
    const prefix = sanitizeBucketPrefix(process.env.S3_BUCKET_PREFIX || "pra-docs");
    const tenantPart = sanitizeTenantId(tenantId) || "tenant";
    const candidate = `${prefix}-${tenantPart}`;
    return candidate.slice(0, 63).replace(/-+$/g, "");
}
function assertTenantBucket(bucket, tenantId) {
    const expectedBucket = getTenantBucketName(tenantId);
    if (bucket !== expectedBucket) {
        throw new Error(`Bucket ${bucket} does not match tenant scope`);
    }
}
async function ensureBucketExists(bucket) {
    const sdk = await loadS3Sdk();
    const s3Client = await getS3Client();
    try {
        await s3Client.send(new sdk.HeadBucketCommand({ Bucket: bucket }));
    }
    catch (err) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
            await s3Client.send(new sdk.CreateBucketCommand({ Bucket: bucket }));
        }
        else {
            throw err;
        }
    }
}
function buildObjectKey(tenantId, originalName) {
    const safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const tenant = sanitizeTenantId(tenantId) || "tenant";
    return `${tenant}/${uniquePrefix}-${safeName}`;
}
function extractObjectKey(storagePath, storedName) {
    const trimmed = (storagePath || "").trim();
    if (trimmed.startsWith("s3://")) {
        const withoutScheme = trimmed.slice("s3://".length);
        const [, ...keyParts] = withoutScheme.split("/");
        const key = keyParts.join("/");
        if (key)
            return key;
    }
    const normalized = trimmed.replace(/^\/+/, "");
    if (normalized)
        return normalized;
    if (storedName)
        return storedName;
    throw new Error("Unable to resolve object key from storagePath or storedName");
}
function resolveBucketAndKey(storagePath, tenantId, storedName) {
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
async function uploadObjectToBucket(params) {
    const sdk = await loadS3Sdk();
    const s3Client = await getS3Client();
    await ensureBucketExists(params.bucket);
    await s3Client.send(new sdk.PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentLength: params.body.byteLength,
    }));
}
async function getSignedUrlForObject(bucket, key, ttlSeconds) {
    const sdk = await loadS3Sdk();
    const { getSignedUrl } = await loadPresigner();
    const s3Client = await getS3Client();
    const expiresIn = Math.max(60, Math.min(ttlSeconds || DEFAULT_SIGNED_URL_TTL, 60 * 60 * 24 * 7));
    const command = new sdk.GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(s3Client, command, { expiresIn });
}
async function downloadObjectToTempFile(bucket, key, preferredName) {
    const sdk = await loadS3Sdk();
    const s3Client = await getS3Client();
    const response = await s3Client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) {
        throw new Error("Object stream is empty");
    }
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stronghold-doc-"));
    const filename = preferredName || path.basename(key) || "object";
    const filePath = path.join(tmpDir, filename);
    const bodyStream = response.Body;
    await (0, promises_1.pipeline)(bodyStream, fs.createWriteStream(filePath));
    return filePath;
}
//# sourceMappingURL=s3Client.js.map