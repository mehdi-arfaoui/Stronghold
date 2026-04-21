# Stronghold Multi-Account E2E Infra

This Terraform stack creates a small two-account AWS environment for validating Stronghold Phase 1 multi-account behavior on real infrastructure.

## Prerequisites

- Two AWS accounts in the same region
- Terraform `>= 1.5`
- AWS CLI configured with two profiles
- Enough permissions to create VPC, EC2, IAM, KMS, Route53, RDS, Lambda, and S3 resources

Example AWS CLI profile setup:

```ini
[profile stronghold-test-prod]
region = eu-west-3

[profile stronghold-test-staging]
region = eu-west-3
```

## What Gets Deployed

- Prod account:
  - VPC, subnets, security groups, EC2 app instance
  - RDS MySQL instance encrypted with a dedicated KMS key
  - S3 bucket encrypted with SSE-KMS
  - Lambda function
  - Scanner role trusted by the staging cross-account role
  - App role trusted only by `ec2.amazonaws.com`
  - Private Route53 zone associated to prod and staging VPCs
  - Cross-account VPC peering to staging
- Staging account:
  - VPC, subnets, security group, EC2 app instance
  - Unencrypted S3 bucket
  - Cross-account role allowed to assume the prod scanner role

## Setup

```bash
cd infra/test-multi-account
cp terraform.tfvars.example terraform.tfvars
```

Fill `terraform.tfvars`, then deploy:

```bash
terraform init
terraform plan
terraform apply
```

RDS creation is usually the slowest step. Expect the full `apply` to take roughly 12-15 minutes.

## Generate Stronghold Config

```bash
terraform output -raw stronghold_config_yaml > ../../.stronghold/config.yml
```

## Run E2E Tests

Set the required environment variables first:

```bash
export STRONGHOLD_E2E=true
export STRONGHOLD_E2E_PROD_ACCOUNT=111122223333
export STRONGHOLD_E2E_STAGING_ACCOUNT=444455556666
export STRONGHOLD_E2E_REGION=eu-west-3
```

Then run the E2E suite from `packages/core`:

```bash
cd ../../packages/core
npm run test:e2e
```

The E2E harness expects the generated config at `.stronghold/config.yml`, or a custom path via `STRONGHOLD_E2E_CONFIG`.

## Cleanup

Destroy the environment as soon as the validation session is complete:

```bash
cd ../../infra/test-multi-account
./destroy.sh
```

## Cost

- Two `t3.micro` instances: about `$0.022/h`
- One `db.t3.micro` instance: about `$0.018/h`
- One KMS key: about `$1/month` prorated
- S3 and Route53: negligible for a short-lived test session

Typical session cost is about `$0.05/h`, or roughly `$0.40` for an 8-hour validation window.

## Troubleshooting

- VPC peering:
  - Terraform accepts the peering from staging automatically with `aws_vpc_peering_connection_accepter`.
- KMS grants:
  - `ListGrants` can lag slightly after `terraform apply`. Wait about one minute before launching E2E tests.
- Route53 private hosted zone sharing:
  - This uses the standard owner-side authorization plus consumer-side association flow. If the association fails, verify both provider profiles point to the intended accounts.
- RDS:
  - Provisioning takes the longest. If `terraform apply` seems idle, check the RDS instance status in the prod account.
- Windows shells:
  - The cleanup helper is `destroy.sh`. Run it from Git Bash or WSL if needed.

## Security Notes

- Never commit `terraform.tfvars`, `terraform.tfstate*`, `.terraform/`, or AWS credentials.
- Terraform state contains infrastructure identifiers and should be treated as sensitive.
- The generated Stronghold config stores account selection only. Credentials remain in the local AWS CLI profile store.
