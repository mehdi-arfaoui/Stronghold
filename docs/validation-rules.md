# DR Validation Rules

Stronghold validates disaster-recovery posture, not general cloud hygiene. A rule exists only when it helps answer a DR question such as:

- Can this resource be restored?
- Can it fail over?
- Will we detect trouble quickly enough?
- Do we have a secondary copy in another zone or region?

Results can be `pass`, `fail`, `warn`, `skip`, or `error`.

- `pass`, `fail`, and `warn` affect the score
- `skip` and `error` are excluded from scoring
- some rules intentionally `skip` when a prerequisite is missing, such as `ec2_multi_az` without an Auto Scaling group

Source of truth: [validation-rules.ts](../packages/core/src/validation/validation-rules.ts)

## Categories

| Category | Purpose |
| --- | --- |
| `backup` | Backup coverage, retention, PITR, versioning |
| `redundancy` | Multi-AZ placement, zonal resilience, NAT redundancy |
| `failover` | Automatic failover and DNS cutover readiness |
| `detection` | Alarms and health checks |
| `recovery` | Replacement and dead-letter recovery mechanics |
| `replication` | Replicas, cross-region copies, global data services |

## Backup Rules

| Rule ID | Severity | Applies to | What it checks |
| --- | --- | --- | --- |
| `rds_backup_configured` | high | RDS | Automated backups are enabled |
| `backup_retention_adequate` | medium | RDS | Backup retention is at least 7 days |
| `backup_plan_exists` | critical | RDS, EC2, DynamoDB, EFS | Resource is covered by an AWS Backup plan |
| `backup_recent` | high | RDS, EC2, DynamoDB, EFS, S3 | A recent backup exists, typically within the last 25 hours |
| `backup_lifecycle_configured` | medium | AWS Backup plans | Recovery points include lifecycle / retention configuration |
| `s3_versioning_enabled` | high | S3 | Bucket versioning is enabled |
| `dynamodb_pitr_enabled` | critical | DynamoDB | Point-in-time recovery is enabled |
| `aurora_backup_configured` | critical | Aurora clusters | Automated backups are enabled |
| `aurora_backup_retention_adequate` | medium | Aurora clusters | Backup retention is at least 7 days |
| `aurora_deletion_protection` | high | Aurora clusters | Deletion protection is enabled |
| `efs_backup_enabled` | critical | EFS | Automatic EFS backups are enabled |

## Redundancy Rules

| Rule ID | Severity | Applies to | What it checks |
| --- | --- | --- | --- |
| `ec2_multi_az` | high | EC2 | Instances are spread across at least two AZs through Auto Scaling |
| `elb_multi_az` | critical | ELB | Load balancer is attached to at least two AZs |
| `elb_cross_zone` | high | ELB | Cross-zone load balancing is enabled |
| `eks_multi_az` | critical | EKS | Cluster subnets span at least two AZs |
| `vpc_multi_az_subnets` | high | VPC | The VPC has subnets in at least two AZs |
| `vpc_nat_redundancy` | medium | VPC | NAT gateway count avoids a single zonal bottleneck |
| `aurora_multi_az` | critical | Aurora clusters | Aurora members span multiple AZs |
| `efs_multi_az` | critical | EFS | File system is regional, not One Zone |
| `efs_mount_target_multi_az` | high | EFS | Mount targets cover at least two AZs |

## Failover Rules

| Rule ID | Severity | Applies to | What it checks |
| --- | --- | --- | --- |
| `rds_multi_az_active` | high | RDS | Multi-AZ is enabled |
| `elasticache_failover` | high | ElastiCache | Automatic failover is enabled |
| `route53_health_check` | high | Route53 records | Failover records have a health check |
| `route53_failover_configured` | critical | Route53 hosted zones | Primary and secondary failover records exist |
| `route53_ttl_appropriate` | medium | Route53 records | Failover TTL is low enough for practical cutover |
| `aurora_replica_exists` | critical | Aurora clusters | At least one replica exists |
| `aurora_promotion_tier` | medium | Aurora clusters | A candidate replica has an appropriate promotion tier |

## Detection Rules

| Rule ID | Severity | Applies to | What it checks |
| --- | --- | --- | --- |
| `cloudwatch_alarm_exists` | high | RDS, EC2, ELB, Lambda | At least one CloudWatch alarm targets the resource |
| `cloudwatch_alarm_actions` | high | CloudWatch alarms | Alarm actions are enabled and configured |
| `elb_health_check` | high | ELB | A health check is configured on the load balancer / target groups |

## Recovery Rules

| Rule ID | Severity | Applies to | What it checks |
| --- | --- | --- | --- |
| `ec2_in_asg` | high | EC2 | Instance belongs to an Auto Scaling group |
| `lambda_dlq_configured` | medium | Lambda | Lambda function has a DLQ target |
| `sqs_dlq_configured` | medium | SQS | Queue has a redrive policy / DLQ |

## Replication Rules

| Rule ID | Severity | Applies to | What it checks |
| --- | --- | --- | --- |
| `rds_replica_healthy` | critical | RDS | At least one read replica is present |
| `s3_replication_active` | critical | S3 | At least one replication rule is active |
| `cross_region_exists` | high | RDS, S3 | There is a replica or linked target in another region |
| `aurora_global_database` | low | Aurora clusters | Cluster participates in an Aurora Global Database |
| `dynamodb_global_table` | low | DynamoDB | Table is configured as a global table |
| `efs_replication_configured` | high | EFS | Replication is configured to another target |

## Reading the Output

Every result includes:

- the rule ID
- the affected node ID and node name
- severity and category
- a remediation message when applicable
- a weight breakdown for scoring

For example, a failure on `backup_plan_exists` means Stronghold could not find AWS Backup coverage for that resource in the current graph snapshot. It does not mean the resource is unrecoverable forever, only that Stronghold cannot verify the backup mechanism from the scanned metadata.

For scoring details, see [Scoring](./scoring.md).
