# Stronghold v1.0.0

The first stable release of Stronghold -- open-source disaster recovery intelligence for AWS.

## Install

```bash
npx @stronghold-dr/cli demo
npx @stronghold-dr/cli scan --region eu-west-1
```

## What's in v1.0.0

**Service-centric DR intelligence.** Stronghold maps AWS resources into services and reasons about recoverability at the service level, not just the resource level.

**Evidence-backed posture.** Five evidence maturity levels (observed, inferred, declared, tested, expired) with confidence-weighted scoring. Know the difference between "config exists" and "recovery was proven."

**Scenario coverage analysis.** Built-in AZ failure, region failure, SPOF failure, and data corruption scenarios. Coverage verdicts tell you which services survive which disruptions.

**Living runbooks.** Generated DR plans and executable runbooks validated against current infrastructure. Stale recovery references are flagged before an incident exposes them.

**Posture memory.** Scan history, finding lifecycle tracking, DR debt, and trend analysis. See whether your DR posture is improving, stable, or degrading.

**Lightweight governance.** Declared ownership, risk acceptance with mandatory expiration, and custom policy enforcement.

### Infrastructure

- Read-only AWS discovery across 16 services with bounded concurrency, retries, and per-scanner timeouts
- Multi-account support with `--profile`, `--role-arn`, and named account configuration
- AES-256-GCM encryption, redaction engine, and always-on audit trail

### DR Engine

- 39 validation rules across 6 DR categories
- Weighted scoring with severity ceiling, role-aware weighting, and evidence maturity
- DRP-as-Code generation with topological recovery ordering
- Executable runbooks with real AWS CLI commands and honest RTO/RPO

### Operations

- Drift detection between scans with DRP impact analysis
- CI-native integration with `--format json`, `--output json`, `--fail-threshold`, and GitHub Actions annotations
- Demo mode with 3 scenarios (startup, enterprise, minimal)
- Self-hosted deployment with Docker Compose (Express + React + PostgreSQL)

## Documentation

- [Getting Started](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/getting-started.md)
- [Architecture](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/architecture.md)
- [Service Model](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/services.md)
- [Evidence Model](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/evidence.md)
- [Scenario Coverage](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/scenarios.md)
- [Governance](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/governance.md)
- [Posture History](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/history.md)
- [Security Model](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/security.md)
- [Scoring Methodology](https://github.com/mehdi-arfaoui/Stronghold/blob/main/docs/scoring.md)

## Technical Foundation

- TypeScript strict mode, zero `any`, `noUncheckedIndexedAccess: true`
- Monorepo: `@stronghold-dr/core` (pure business logic) + `@stronghold-dr/cli` + server + web
- 654 passing automated tests, 81.62% core line coverage
- AGPL-3.0

## Links

- [npm: @stronghold-dr/cli](https://www.npmjs.com/package/@stronghold-dr/cli)
- [npm: @stronghold-dr/core](https://www.npmjs.com/package/@stronghold-dr/core)
- [Website: stronghold.software](https://stronghold.software)
