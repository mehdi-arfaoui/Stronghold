# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Encryption support for scan results with the CLI `--encrypt` flag and the server-side `STRONGHOLD_ENCRYPTION_KEY` setting.
- A redaction engine for sensitive infrastructure data with the CLI `--redact` flag and the server `?redact=true` report query parameter.
- An audit trail for CLI and server workflows with `.stronghold/audit.jsonl`, the `AuditLog` table, and `GET /api/audit`.
- Security documentation in [docs/security.md](docs/security.md).
- An AGPL licensing FAQ in [docs/licensing-faq.md](docs/licensing-faq.md).

## [0.1.0] - Unreleased

### Added

- AWS infrastructure discovery across 16 services: EC2, RDS, Aurora, S3, Lambda, DynamoDB, ElastiCache, SQS, SNS, ELB, EKS, EFS, VPC, Route53, AWS Backup, and CloudWatch.
- Dependency graph analysis with SPOF detection, blast radius analysis, and topological recovery ordering.
- DR validation engine with 39 automated rules across 6 categories: backup, redundancy, failover, detection, recovery, and replication.
- Weighted DR posture scoring with transparent methodology and impact-aware prioritization.
- DRP-as-Code generation in YAML, plus executable runbook generation with AWS CLI recovery commands.
- Honest RTO/RPO estimation with documented sources and explicit nulls when evidence is missing.
- Drift detection between scans, including stale-DRP detection in the self-hosted flow.
- CLI workflows for demo mode, multi-region scan, service filtering, IAM policy generation, report export, and runbook export.
- Self-hosted Docker Compose deployment with Express API, React UI, PostgreSQL, and smoke-tested health checks.
- Web UI with DR posture dashboard, report viewer, plan export, drift timeline, and interactive dependency graph.

### Technical foundation

- Monorepo layout with `@stronghold-dr/core`, `@stronghold-dr/cli`, `@stronghold-dr/server`, and `@stronghold-dr/web`.
- Hexagonal architecture with business logic isolated in `@stronghold-dr/core` and no framework dependencies in the domain package.
- TypeScript strict mode, zero `any`, and generated public declarations for the core package.
- 315 automated tests passing across core, CLI, and server.
- 73.96% coverage in `@stronghold-dr/core` from the release validation run.
- AGPL-3.0 licensing across all published package metadata.
