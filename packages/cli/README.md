# @stronghold-dr/cli

CLI for [Stronghold](https://github.com/mehdi-arfaoui/Stronghold) -- open-source disaster recovery intelligence for AWS.

Stronghold scans your AWS infrastructure, maps it into services, validates DR readiness, tracks evidence maturity, evaluates scenario coverage, generates recovery plans, and monitors posture drift over time.

Read-only by design. Zero telemetry. Runs entirely in your environment.

## Quick Start

```bash
# Try with built-in demo infrastructure
npx @stronghold-dr/cli demo

# Scan a real AWS account
npx @stronghold-dr/cli scan --region eu-west-1

# See your DR posture
npx @stronghold-dr/cli status

# Full report
npx @stronghold-dr/cli report

# Generate DR plan
npx @stronghold-dr/cli plan generate > drp.yaml
```

## Install

```bash
# Use directly with npx (no install needed)
npx @stronghold-dr/cli <command>

# Or install globally
npm install -g @stronghold-dr/cli
stronghold <command>
```

## Commands

| Intent | Commands |
| --- | --- |
| Discover | `demo`, `scan`, `init`, `iam-policy`, `services detect`, `services list`, `overrides init`, `overrides validate` |
| Assess | `status`, `report`, `scenarios`, `scenarios list`, `scenarios show <id>`, `services show <name>` |
| Plan | `plan generate`, `plan runbook`, `plan validate` |
| Track | `drift check`, `history` |
| Govern | `evidence add`, `evidence list`, `evidence show <id>`, `governance`, `governance init`, `governance accept`, `governance validate` |

Run `stronghold --help` or `stronghold <command> --help` for all options.

## Key Options

| Flag | Description |
| --- | --- |
| `--region <regions>` | AWS region(s) to scan |
| `--all-regions` | Scan all enabled regions |
| `--encrypt` | Encrypt scan artifacts and generated files at rest |
| `--redact` | Mask infrastructure identifiers in output |
| `--verbose` | Show detailed scan and retry logs |
| `--profile <profile>` | AWS named profile |
| `--role-arn <arn>` | Assume an IAM role for scanning |
| `--output json` | JSON output for `scan` and `demo` |
| `--format json` | JSON output for `report`, `plan`, and `drift check` |

## Requirements

- Node.js 20 or later
- AWS credentials with read-only access ([generate the policy](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/getting-started.md#2-generate-the-read-only-iam-policy))

## Documentation

- [Getting Started](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/architecture.md)
- [Security Model](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/security.md)
- [All Documentation](https://github.com/mehdi-arfaoui/Stronghold#documentation)

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0)
