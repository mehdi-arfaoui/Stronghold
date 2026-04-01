# Getting Started

## Prerequisites

- Node.js 20 or later
- An AWS account with infrastructure to scan, or use demo mode

If you install Stronghold globally, replace `npx @stronghold-dr/cli` with `stronghold` in the examples below.

## Try the Demo First

```bash
npx @stronghold-dr/cli demo
```

This runs Stronghold against built-in sample infrastructure and saves the result to `.stronghold/latest-scan.json`.

Indicative timing:

- Demo scenarios usually finish in a few seconds.
- A real single-region scan often takes tens of seconds.
- Large or multi-region accounts can take a few minutes depending on API latency, enabled services, and permission gaps.

Three demo scenarios are available:

| Scenario | Resources | Typical Score | Use Case |
| --- | --- | --- | --- |
| `startup` (default) | 24 | `52/100` | Typical startup with obvious DR gaps |
| `enterprise` | 66 | `83/100` | Mature setup with redundancy and replication |
| `minimal` | 8 | `5/100` | Intentionally weak baseline for testing |

```bash
npx @stronghold-dr/cli demo --scenario enterprise
```

After the demo, inspect the saved results:

```bash
npx @stronghold-dr/cli report
npx @stronghold-dr/cli report --category backup
npx @stronghold-dr/cli plan generate > drp.yaml
```

## Scan Your Real AWS Infrastructure

### 1. Set Up AWS Credentials

Stronghold uses the standard AWS credential chain. Any of these works:

Environment variables:

```bash
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=eu-west-1
```

Named profile:

```bash
aws configure --profile production
export AWS_PROFILE=production
export AWS_DEFAULT_REGION=eu-west-1
```

AWS SSO:

```bash
aws sso login --profile production
export AWS_PROFILE=production
export AWS_DEFAULT_REGION=eu-west-1
```

### 2. Generate the Read-Only IAM Policy

```bash
npx @stronghold-dr/cli iam-policy > stronghold-policy.json
```

Create that policy in AWS IAM and attach it to the user or role Stronghold will use.

The generated policy is read-only. Stronghold calls `Describe*`, `List*`, and `Get*` APIs to inspect infrastructure metadata. It does not mutate resources, and these permissions do not grant access to object contents, database rows, queue messages, or application payloads.

### 3. Run the Scan

```bash
# Single region
npx @stronghold-dr/cli scan --region eu-west-1

# Multiple regions
npx @stronghold-dr/cli scan --region eu-west-1,us-east-1

# All enabled regions in the account
npx @stronghold-dr/cli scan --all-regions

# Only specific services
npx @stronghold-dr/cli scan --region eu-west-1 --services rds,aurora,s3
```

Notes:

- `vpc` is added automatically when you filter services because AZ and subnet context is needed by several rules.
- If a service cannot be queried because of missing permissions or an unavailable API, Stronghold skips that service and continues the rest of the scan.

### Security Options

If you are scanning a real production environment, use the built-in security controls from the start:

```bash
npx @stronghold-dr/cli scan --region eu-west-1 --encrypt --passphrase "change-me"
npx @stronghold-dr/cli report --redact
```

The CLI audit trail is always enabled and written to `.stronghold/audit.jsonl`.

### 4. Review the Report

```bash
npx @stronghold-dr/cli report
```

The report includes:

- A DR posture score from `0` to `100` and a grade from `A` to `F`
- Scores by DR category: backup, redundancy, failover, detection, recovery, replication
- Failures ordered by impact, with remediation guidance

You can also filter:

```bash
npx @stronghold-dr/cli report --category failover
npx @stronghold-dr/cli report --severity high
npx @stronghold-dr/cli report --format markdown
```

### 5. Generate a DR Plan

```bash
npx @stronghold-dr/cli plan generate > drp.yaml
```

The generated YAML contains:

- Logical services and their components
- Recovery strategy and recovery steps per component
- Recovery order per service, respecting dependencies
- Honest RTO and RPO estimates, including uncertainty
- An infrastructure hash for drift validation

Commit `drp.yaml` to your repository. The scan snapshot in `.stronghold/latest-scan.json` is local working state and is gitignored by default because it contains detailed infrastructure metadata. If you use `--encrypt`, the saved snapshot becomes `.stronghold/latest-scan.stronghold-enc`.

Validate the plan after infrastructure changes:

```bash
npx @stronghold-dr/cli plan validate --plan drp.yaml
```

### 6. Track Drift Over Time

Establish a baseline, then compare future scans against it:

```bash
# First baseline
npx @stronghold-dr/cli drift check --save-baseline

# Later, after changes
npx @stronghold-dr/cli scan --region eu-west-1
npx @stronghold-dr/cli drift check
```

The baseline is stored in `.stronghold/baseline-scan.json`, or `.stronghold/baseline-scan.stronghold-enc` when `--encrypt` is enabled.

## Next Steps

- [Architecture overview](./architecture.md)
- [Security model](./security.md)
- [DRP YAML specification](./drp-spec.md)
- [AWS provider details](./providers/aws.md)
- [Validation rules reference](./validation-rules.md)
- [Scoring methodology](./scoring.md)
- [Self-hosted deployment](./self-hosted.md)
