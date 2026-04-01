# Architecture

## Overview

Stronghold follows a ports-and-adapters architecture. The domain logic lives in `@stronghold-dr/core`; the CLI, server, and web app orchestrate or present that logic without owning recovery rules themselves.

```text
+--------------------------------------------------------+
|                    Entry Points                        |
|         CLI              Server             Web UI     |
+--------------------------------------------------------+
|                  @stronghold-dr/core                   |
|                                                        |
|  Discovery -> Enrichment -> Graph -> Analysis          |
|                           -> Validation -> DRP -> Drift|
+--------------------------------------------------------+
|               Cross-cutting Concerns                   |
|        Encryption      Redaction      Audit Trail      |
+--------------------------------------------------------+
|                   Ports & Adapters                     |
|    File store     Prisma/PostgreSQL      Logger        |
+--------------------------------------------------------+
```

## Monorepo Structure

| Package | Purpose | Notes |
| --- | --- | --- |
| `packages/core` | Pure business logic | Graph analysis, validation, DRP generation, drift detection, provider adapters |
| `packages/cli` | Community CLI | Stores scans under `.stronghold/` in the current working directory |
| `packages/server` | Express API | Persists scans, reports, plans, drift events, and audit logs with Prisma/PostgreSQL |
| `packages/web` | React UI | Consumes the server API and visualizes graph, posture, plans, and drift |

## Scan Pipeline

### 1. Discovery

The AWS adapter queries cloud APIs and emits normalized `DiscoveredResource` records. Stronghold currently exposes 16 user-selectable AWS service groups:

- `ec2`
- `rds`
- `aurora`
- `s3`
- `lambda`
- `dynamodb`
- `elasticache`
- `sqs`
- `sns`
- `elb`
- `eks`
- `efs`
- `vpc`
- `route53`
- `backup`
- `cloudwatch`

Internally, some of these expand into more detailed discovery:

- `ec2` also pulls Auto Scaling context
- `vpc` includes subnets, security groups, and NAT gateways
- enrichers add metadata for S3 replication, DynamoDB PITR, EC2 ASG membership, and ElastiCache failover

### 2. Graph Construction

`transformToScanResult()` maps provider resources into nodes and edges, then dependency inference adds missing relationships. Stronghold prefers high-signal sources first:

- security group ingress chains
- Lambda event source mappings
- Lambda environment references
- SQS redrive policies
- SNS subscriptions

If those signals are thin, best-effort heuristics kick in:

- shared subnet or VPC placement
- shared tags
- naming patterns
- generic fallback inference

### 3. Dependency Inference Limits

Inference is intentionally additive, not authoritative.

- Stronghold only knows what the cloud APIs expose. Hidden runtime dependencies inside application code are out of scope.
- Environment-variable and naming heuristics can miss relationships or occasionally suggest a dependency that needs human review.
- Transitive dependency chains depend on inference quality, so Stronghold stays conservative in scoring and uses direct dependents only for blast-radius weighting.
- Missing permissions reduce graph fidelity. A skipped service means some downstream rules and inferred edges may also be incomplete.

In practice, inferred edges are useful for prioritization and review, but they are not a substitute for architecture knowledge from the team that owns the system.

### 4. Graph Analysis

`analyzeFullGraph()` runs deterministic passes over the graph:

- SPOF detection
- criticality scoring
- redundancy analysis
- regional concentration analysis
- circular dependency detection
- cascade chain analysis

### 5. Validation and Scoring

Validation rules are pure functions over nodes, edges, and optional DRP context. They produce `pass`, `fail`, `warn`, `skip`, or `error` with remediation guidance.

The overall DR posture score is calculated from:

```text
weight = severityWeight x criticalityWeight x blastRadiusWeight
```

See [Scoring](./scoring.md) for the exact formula and weighting details.

### 6. DRP Generation

The DRP generator groups components into logical services and derives:

- recovery strategy per component
- human-readable recovery steps
- validation probes after recovery
- recovery order within each service
- RTO and RPO estimates, including evidence and limitations
- effective chain-aware RTO after dependency propagation

The output is declarative YAML or JSON. It documents what should be restored and in what order; it does not execute the restore.

### 7. Drift Detection

Drift compares two scan snapshots using deterministic resource matching by ID. It flags:

- added or removed resources
- configuration changes that affect DR posture
- dependency changes
- DRP staleness when a previously generated plan no longer matches the live graph

## Security Layers

The security controls are cross-cutting concerns rather than extra pipeline stages:

- Encryption protects sensitive scan artifacts at rest in the CLI and, when configured, in the server persistence layer.
- Redaction masks infrastructure identifiers before reports, markdown, JSON exports, or API responses are shared.
- Audit Trail records execution metadata for scan, report, plan, and drift workflows without storing scan payloads.

## Ports and Adapters

The core package defines domain interfaces. Adapters differ by entry point:

| Concern | CLI adapter | Server adapter |
| --- | --- | --- |
| Scan storage | Local JSON files | Prisma/PostgreSQL |
| Infrastructure storage | Local JSON files | Prisma/PostgreSQL |
| Logging | Console output | Structured server logs |
| Audit trail | JSONL file | Prisma `AuditLog` table |

This separation is why the same validation, scoring, DRP, and drift code can run in both CLI and server contexts.

## Key Design Decisions

### Keep Core Framework-Free

`packages/core` does not depend on Express or React. That keeps the domain reusable from the CLI, the API, tests, and future integrations.

### Use Graphology-Compatible Graphs

The graph layer targets a graphology-compatible interface so algorithms stay portable and testable while still benefiting from a mature graph toolkit.

### Prefer Honest Estimates Over Fake Precision

When AWS publishes reliable timings, Stronghold can surface them. When it does not, Stronghold uses `unverified` estimates or `null` bounds rather than inventing precise-looking numbers.

### Store Community CLI State Locally

The CLI writes scan results to `.stronghold/` so users can inspect, diff, validate, encrypt, redact, and audit locally without any telemetry requirement.

## Testing

Stronghold's day-to-day quality gates are the repository-level scripts:

- `npm run typecheck`
- `npm run build`
- `npm run test`

Package-level coverage focuses on the core logic that most often regresses:

- core Vitest suites cover validation, scoring, DRP generation, RTO estimation, graph behavior, redaction, encryption, and drift logic
- server tests cover route behavior, Prisma-backed adapters, and audit pagination
- CLI workflows are exercised through command and pipeline tests, plus demo scenarios
