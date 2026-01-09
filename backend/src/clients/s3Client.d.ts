export declare function getTenantBucketName(tenantId: string): string;
export declare function ensureBucketExists(bucket: string): Promise<void>;
export declare function buildObjectKey(tenantId: string, originalName: string): string;
export declare function extractObjectKey(storagePath?: string | null, storedName?: string | null): string;
export declare function resolveBucketAndKey(storagePath: string | null | undefined, tenantId: string, storedName?: string | null): {
    bucket: string;
    key: string;
};
export declare function uploadObjectToBucket(params: {
    bucket: string;
    key: string;
    body: Buffer;
    contentType?: string;
}): Promise<void>;
export declare function getSignedUrlForObject(bucket: string, key: string, ttlSeconds?: number): Promise<any>;
export declare function getSignedUploadUrlForObject(bucket: string, key: string, contentType?: string, ttlSeconds?: number): Promise<{
    url: string;
    expiresIn: number;
}>;
export declare function downloadObjectToTempFile(bucket: string, key: string, preferredName?: string): Promise<string>;
//# sourceMappingURL=s3Client.d.ts.map
