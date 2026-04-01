# AWS Provider

## Scope

The AWS provider is the only production-ready provider in the community CLI today. It discovers infrastructure, enriches metadata, builds a dependency graph, validates DR posture, and generates a DRP from the resulting snapshot.

## Supported Service Groups

These are the 16 service groups currently exposed through `--services`:

| Service flag | Scanner | Node types produced | DR-focused metadata examples |
| --- | --- | --- | --- |
| `ec2` | `ec2-scanner` + ASG enricher | `EC2`, `ASG` | `availabilityZone`, `subnetId`, `securityGroups`, `autoScalingGroupName` |
| `rds` | `rds-scanner` | `RDS` | `multiAz`, `backupRetentionPeriod`, `readReplicaDBInstanceIdentifiers`, `endpointAddress` |
| `aurora` | `aurora-scanner` | `AURORA_CLUSTER`, `AURORA_INSTANCE`, `AURORA_GLOBAL` | `availabilityZones`, `replicaCount`, `globalClusterIdentifier`, `promotionTier`, `deletionProtection` |
| `s3` | `s3-scanner` + replication enricher | `S3_BUCKET` | `bucketArn`, `region`, `versioningStatus`, `replicationRules` |
| `lambda` | `lambda-scanner` | `LAMBDA` | `deadLetterTargetArn`, `eventSourceMappings`, `environmentReferences`, `subnetIds` |
| `dynamodb` | `dynamodb-scanner` + PITR enricher | `DYNAMODB` | `tableArn`, `globalTableVersion`, `replicas`, PITR status |
| `elasticache` | `elasticache-scanner` + failover enricher | `ELASTICACHE` | `replicationGroupId`, `replicaCount`, `configurationEndpoint`, failover metadata |
| `sqs` | `sqs-scanner` | `SQS_QUEUE` | `redrivePolicy`, `deadLetterTargetArn`, `maxReceiveCount` |
| `sns` | `sns-scanner` | `SNS_TOPIC` | `subscriptions`, `fifoTopic`, subscription counts |
| `elb` | `elb-scanner` | `ELB` | `availabilityZones`, `crossZoneLoadBalancing`, `healthChecks`, `subnetIds` |
| `eks` | `eks-scanner` | `EKS`, `EKS_NODEGROUP` | `subnetIds`, `desiredSize`, `minSize`, `maxSize` |
| `efs` | `efs-scanner` | `EFS_FILESYSTEM`, `EFS_MOUNT_TARGET` | `automaticBackups`, `replicationConfigurations`, `availabilityZoneName`, `mountTargetIds` |
| `vpc` | `ec2-scanner` VPC path | `VPC`, `SUBNET`, `SECURITY_GROUP`, `NAT_GATEWAY` | `cidrBlock`, `availabilityZone`, `inboundRules`, `vpcId` |
| `route53` | `route53-scanner` | `ROUTE53_HOSTED_ZONE`, `ROUTE53_RECORD` | `routingPolicy`, `failover`, `healthCheckId`, `ttl`, `aliasTargetDnsName` |
| `backup` | `backup-scanner` | `BACKUP_PLAN`, `BACKUP_VAULT` | `protectedResources`, `lastBackupTime`, `recoveryPoints`, lifecycle data |
| `cloudwatch` | `cloudwatch-scanner` | `CLOUDWATCH_ALARM` | `monitoredReferences`, `actionsEnabled`, `alarmActions`, `state` |

Notes:

- `s3` and `route53` are global services and are scanned once per run.
- `vpc` includes subnets, security groups, and NAT gateways.
- `ec2` and several other services receive extra enrichment passes after raw discovery to improve validation and dependency inference.

## Permissions

Generate the minimal IAM policy with:

```bash
npx @stronghold-dr/cli iam-policy > stronghold-policy.json
```

The policy generator lives in [iam-policy.ts](../../packages/cli/src/config/iam-policy.ts).

Stronghold’s AWS access is read-only:

- It uses `Describe*`, `List*`, and `Get*` APIs.
- It does not mutate infrastructure.
- It does not read S3 object bodies, DynamoDB items, RDS table contents, SQS messages, SNS payloads, or application secrets.

IAM actions used by the generated policy:

- Shared audit identity: `sts:GetCallerIdentity` - called at scan start for audit trail identity. Fails silently if not permitted.
- EC2 and VPC: `ec2:DescribeInstances`, `ec2:DescribeVpcs`, `ec2:DescribeSubnets`, `ec2:DescribeSecurityGroups`, `ec2:DescribeNatGateways`, `ec2:DescribeRegions`, `autoscaling:DescribeAutoScalingGroups`
- RDS and Aurora: `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeGlobalClusters`
- S3: `s3:ListAllMyBuckets`, `s3:GetBucketVersioning`, `s3:GetBucketReplication`, `s3:GetEncryptionConfiguration`
- Lambda: `lambda:ListFunctions`, `lambda:GetFunctionConfiguration`
- DynamoDB: `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `dynamodb:DescribeGlobalTable`
- ElastiCache: `elasticache:DescribeCacheClusters`, `elasticache:DescribeReplicationGroups`
- SQS: `sqs:ListQueues`, `sqs:GetQueueAttributes`
- SNS: `sns:ListTopics`, `sns:GetTopicAttributes`, `sns:ListSubscriptionsByTopic`
- ELB: `elasticloadbalancing:DescribeLoadBalancers`, `elasticloadbalancing:DescribeTargetGroups`, `elasticloadbalancing:DescribeTargetHealth`, `elasticloadbalancing:DescribeLoadBalancerAttributes`
- EKS: `eks:ListClusters`, `eks:DescribeCluster`
- EFS: `elasticfilesystem:DescribeFileSystems`, `elasticfilesystem:DescribeMountTargets`, `elasticfilesystem:DescribeReplicationConfigurations`, `elasticfilesystem:DescribeBackupPolicy`
- Route53: `route53:ListHostedZones`, `route53:ListResourceRecordSets`
- Backup: `backup:ListBackupPlans`, `backup:ListBackupSelections`, `backup:ListProtectedResources`, `backup:ListRecoveryPointsByBackupVault`, `backup:GetBackupPlan`
- CloudWatch: `cloudwatch:DescribeAlarms`

What it can read is infrastructure metadata that matters for DR:

- ARNs and names
- region and AZ placement
- backup, replication, and failover configuration
- network relationships and health-check configuration
- tags and selected endpoint metadata

## Multi-Region Scans

```bash
# Explicit regions
npx @stronghold-dr/cli scan --region eu-west-1,us-east-1,ap-southeast-1

# All enabled regions in the account
npx @stronghold-dr/cli scan --all-regions
```

When multiple regions are scanned, Stronghold:

1. Discovers resources region by region.
2. Scans global services once.
3. Merges everything into one normalized graph.
4. Resolves cross-region replication and failover relationships where metadata makes that possible.

Each node still retains its own `region`.

## Service Filtering

```bash
npx @stronghold-dr/cli scan --region eu-west-1 --services rds,aurora,s3
```

Important behavior:

- `vpc` is always included automatically because subnet and AZ context is required by several validation rules.
- Filtering changes both discovery cost and graph completeness, so a narrow scan may under-report some dependencies or category scores.

## Partial Scans and Permission Gaps

Stronghold is designed to degrade gracefully. If a service cannot be queried:

- the scan continues
- the affected service is skipped
- a warning is attached to the scan result

Typical warnings include:

- `AccessDenied`
- expired credentials
- invalid credentials
- API timeout
- service-specific follow-up metadata unavailable

This matters because an incomplete scan can still be useful, but the graph and rule coverage will be narrower. If `backup` or `cloudwatch` are skipped, expect backup or detection findings to be incomplete rather than magically green.

## What Dependency Inference Uses

The AWS provider feeds the graph engine with explicit and inferred relationships. The strongest inference signals are:

- security-group-to-security-group traffic chains
- Lambda event source mappings
- Lambda environment references to AWS resources
- SQS DLQ relationships
- SNS subscriptions to Lambda and SQS

Weaker heuristics, such as shared VPC placement, tags, and naming, are only used as fallback. They help with prioritization but are not perfect architecture truth.

## Aurora vs. RDS

Aurora is scanned separately from standard RDS instances. The RDS scanner excludes Aurora engines to avoid duplicates.

This split exists because Aurora has distinct DR behavior:

- cluster-level failover instead of instance-level Multi-AZ only
- separate writer and reader members
- optional global-database topology
- promotion tiers and cluster-specific backup behavior

## Adding a New AWS Scanner

Follow the existing provider pattern:

1. Add a scanner under `packages/core/src/providers/aws/services/`.
2. Emit normalized `DiscoveredResource` objects with DR-relevant metadata only.
3. Register the scanner in `aws-scanner.ts`.
4. Add validation rules if the service introduces DR checks.
5. Extend graph inference or enrichers only when the raw API data is insufficient.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for repository workflow details.
