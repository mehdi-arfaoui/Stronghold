# Stronghold DR Check

GitHub Action that scans your AWS infrastructure and reports DR posture impact on pull requests.

This package is developed inside the Stronghold monorepo under `github-action/`. When you're ready to publish it on the GitHub Marketplace, move the contents of this folder into the dedicated repository `mehdi-arfaoui/stronghold-dr-check`.

## Usage

```yaml
name: DR Check
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  dr-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Stronghold DR Check
        uses: mehdi-arfaoui/stronghold-dr-check@v1
        with:
          aws-region: 'eu-west-1'
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          fail-under-score: 60
          fail-on-score-drop: 10
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `aws-region` | ✅ | — | AWS region(s), comma-separated |
| `aws-access-key-id` | ✅ | — | AWS Access Key (use secrets) |
| `aws-secret-access-key` | ✅ | — | AWS Secret Key (use secrets) |
| `aws-session-token` | ❌ | — | AWS Session Token |
| `services` | ❌ | all | Services to scan |
| `fail-under-score` | ❌ | 0 | Fail if score below threshold |
| `fail-on-score-drop` | ❌ | 0 | Fail if score drops by more than N |
| `comment-on-pr` | ❌ | true | Post comment on PR |
| `baseline-branch` | ❌ | main | Branch used for baseline cache lookup |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | DR posture score (0-100) |
| `grade` | Grade (A-F) |
| `score-delta` | Change from baseline |
| `critical-count` | Number of critical failures |
| `status` | pass or fail |

## Behavior

- Uses `stdio: 'pipe'` when invoking the Stronghold CLI so infrastructure details are not echoed into CI logs.
- Validates AWS credentials with a dedicated 30-second timeout before running the 5-minute infrastructure scan.
- Uses branch-scoped cache keys to avoid baseline poisoning across branches.
- Skips the scan on pull requests when no Terraform, CloudFormation, or CDK files changed.
- Creates or updates a single PR comment using the marker `<!-- stronghold-dr-check -->`.

## What the PR comment looks like

> ## 🟡 Stronghold DR Check
>
> **DR Posture Score: 62/100 (Grade: C)**
>
> 📉 Score change: **-8** (baseline: 70)
>
> ### Critical Issues
> - ❌ **backup_plan_exists** — `prod-db-primary` 🆕
>   No backup plan covers this database.
>   _Impact: 8 direct dependents_

## Security

- All AWS credentials are passed via GitHub Secrets and masked through the Actions runtime.
- Stronghold only logs high-level status from the action, not raw infrastructure details from the CLI.
- Generate the minimal IAM policy with `npx @stronghold-dr/cli iam-policy`.

## Links

- [Stronghold](https://github.com/mehdi-arfaoui/stronghold)
- [Documentation](https://github.com/mehdi-arfaoui/stronghold/blob/main/docs/getting-started.md)
- [stronghold.software](https://stronghold.software)
