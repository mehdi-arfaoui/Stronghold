# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Encryption support for scan results with the CLI `--encrypt` flag and the server-side `STRONGHOLD_ENCRYPTION_KEY` setting.
- A redaction engine for sensitive infrastructure data with the CLI `--redact` flag and the server `?redact=true` report query parameter.
- An audit trail for CLI and server workflows with `.stronghold/audit.jsonl`, the `AuditLog` table, and `GET /api/audit`.
- A service-centric DR intelligence layer with automatic service detection from CloudFormation stack tags, application tags and name prefixes, plus filtered topology clustering as a fallback.
- Manual service definitions in `.stronghold/services.yml` with glob-based resource matching, conflict detection, flagged new matches, and merge precedence over auto-detected services.
- Per-service DR scoring with weakest-link severity ceilings, role-aware weighting, unassigned-resource tracking, and contextual findings that combine technical impact, DR impact, remediation, and scenario-ready placeholders.
- Service-aware CLI workflows with `stronghold services detect`, `stronghold services list`, `stronghold services show <name>`, and `stronghold status`, plus service-first scan and report output with backward-compatible fallback when no services are detected.
- Persisted service posture in the server scan pipeline with dedicated REST endpoints: `GET /api/services`, `GET /api/services/:id`, and `POST /api/services/detect`.
- A new web service experience with a dedicated Services page, per-service detail drill-down, dashboard service overview, and dependency graph coloring/filtering by service.
- An auditable evidence model with five maturity levels (`observed`, `inferred`, `declared`, `tested`, `expired`) and confidence weights carried through validation, scoring, reports, and APIs.
- Automatic evidence extraction for validation results, capturing raw observed metadata keys, values, expectations, timestamps, and inferred graph-based proofs for both passing and failing controls.
- Manual DR test evidence registration with append-only `.stronghold/evidence.jsonl` storage, the CLI commands `stronghold evidence add`, `stronghold evidence list`, and `stronghold evidence show <id>`, plus server endpoints `GET /api/evidence`, `GET /api/evidence/expiring`, and `POST /api/evidence`.
- Evidence freshness tracking with default expiration policies, expiring-soon and expired alerts in `stronghold status`, and retained historical evidence instead of silent deletion.
- Evidence-aware scoring that rewards stronger proof for passing controls, exposes per-rule score decomposition with `stronghold report --explain-score`, and highlights the potential score gap between observed and test-verified resilience.
- Evidence visibility across the product with evidence lines in CLI findings, evidence summaries in scan output, service-detail evidence badges in the web UI, and dashboard evidence alerts.
- Scenario coverage analysis with graph-based disruption modeling for AZ failure, region failure, SPOF failure, data corruption, and custom-ready scenarios without executing against real infrastructure.
- Built-in scenario generation from scan results with default AZ failure and data corruption coverage, top-10 SPOF scenarios by blast radius, optional multi-region failure coverage, and a capped default scenario set for actionable output.
- DRP and runbook coverage validation for scenarios, including evidence-aware verdicts (`covered`, `partially_covered`, `uncovered`, `degraded`) and runbook liveness checks against current infrastructure references.
- Scenario-aware contextual findings, CLI scenario workflows (`stronghold scenarios`, `stronghold scenarios list`, `stronghold scenarios show <id>`), scenario sections in reports/status/scan summaries, and persisted scenario coverage APIs (`GET /api/scenarios`, `GET /api/scenarios/:id`).
- A new web scenario experience with a dedicated Scenarios page, dashboard scenario alerts, and graph scenario mode that highlights direct and cascading disruption impact paths.
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
