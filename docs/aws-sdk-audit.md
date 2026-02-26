# AWS SDK Dependencies Audit

**Date:** 2026-01-28
**Version:** backend@1.0.0

## Summary

All 11 AWS SDK packages in the backend are actively used and should be retained.

## Detailed Usage Report

| Package | Version | Used | Location | Commands/Functions |
|---------|---------|------|----------|-------------------|
| `@aws-sdk/client-ec2` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | EC2Client, DescribeInstancesCommand, DescribeTagsCommand, DescribeRegionsCommand, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeSecurityGroupsCommand |
| `@aws-sdk/client-rds` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | RDSClient, DescribeDBInstancesCommand |
| `@aws-sdk/client-lambda` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | LambdaClient, ListFunctionsCommand, GetFunctionCommand, ListEventSourceMappingsCommand |
| `@aws-sdk/client-auto-scaling` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | AutoScalingClient, DescribeAutoScalingGroupsCommand |
| `@aws-sdk/client-elastic-load-balancing-v2` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand |
| `@aws-sdk/client-eks` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | EKSClient, ListClustersCommand, DescribeClusterCommand, ListNodegroupsCommand, DescribeNodegroupCommand |
| `@aws-sdk/client-sqs` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | SQSClient, ListQueuesCommand, GetQueueAttributesCommand |
| `@aws-sdk/client-sns` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | SNSClient, ListTopicsCommand, GetTopicAttributesCommand, ListSubscriptionsByTopicCommand |
| `@aws-sdk/client-pricing` | ^3.967.0 | Yes | `src/services/awsPricingService.ts` | PricingClient, GetProductsCommand |
| `@aws-sdk/client-s3` | ^3.956.0 | Yes | `src/clients/s3Client.ts` | S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand |
| `@aws-sdk/client-textract` | ^3.965.0 | Yes | `src/services/ocrService.ts` | TextractClient, DetectDocumentTextCommand |
| `@aws-sdk/credential-providers` | ^3.967.0 | Yes | `src/services/discoveryCloudConnectors.ts` | fromTemporaryCredentials |
| `@aws-sdk/s3-request-presigner` | ^3.956.0 | Yes | `src/clients/s3Client.ts` | getSignedUrl |

## Packages to Remove

**None** - All packages are actively used.

## npm vs pnpm Benchmark

| Metric | npm | pnpm | Difference |
|--------|-----|------|------------|
| `node_modules` size | 739 MB | 600 MB | -139 MB (-18.8%) |
| Lockfile lines | 13,059 | 6,923 | -6,136 (-47%) |

### Recommendation

**Stay with npm** - The 18.8% disk space reduction with pnpm is below the 20% threshold that would justify the migration effort. However, consider revisiting this decision if:

1. The project adds significantly more dependencies
2. CI/CD build times become a bottleneck (pnpm is typically faster)
3. Monorepo support becomes necessary (pnpm excels at workspaces)

## Tree-shaking Optimization

The AWS SDK v3 is already modular by design. Deep imports like:

```typescript
import { EC2Client } from '@aws-sdk/client-ec2/dist-es/EC2Client';
```

are **not recommended** because:
- SDK v3 already supports tree-shaking with standard imports
- Deep imports break on SDK updates (internal paths may change)
- Bundlers (esbuild, Rollup, webpack) already eliminate unused code

**Current imports are optimal.**

## Next Steps

1. Monitor AWS SDK versions for security updates
2. Consider `@aws-sdk/lib-dynamodb` if DynamoDB is added later
3. Re-evaluate pnpm migration annually or when dependencies grow significantly
