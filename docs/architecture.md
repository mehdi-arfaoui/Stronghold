# Architecture

## Overview

Stronghold follows a ports-and-adapters architecture. The domain logic lives in `@stronghold-dr/core`; the CLI, server, and web app orchestrate or present that logic without owning recovery rules themselves.

```text
┌────────────────────────────────────────────────────────┐
│                    Entry Points                        │
│        CLI            Server            Web UI         │
├────────────────────────────────────────────────────────┤
│                  @stronghold-dr/core                  │
│                                                        │
│  Discovery -> Enrichment -> Graph -> Analysis         │
│                           -> Validation -> DRP -> Drift│
├────────────────────────────────────────────────────────┤
│                   Ports & Adapters                     │
│   File store      Prisma/PostgreSQL      Logger        │
└────────────────────────────────────────────────────────┘
```

## Monorepo Structure

| Package | Purpose | Notes |
| --- | --- | --- |
| `packages/core` | Pure business logic | Graph analysis, validation, DRP generation, drift detection, provider adapters |
| `packages/cli` | Community CLI | Stores scans under `.stronghold/` in the current working directory |
| `packages/server` | Express API | Persists scans, reports, plans, and drift events with Prisma/PostgreSQL |
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

Internally, some of these expand into more detailed discovery. For example:

- `ec2` also pulls Auto Scaling context
- `vpc` includes subnets, security groups, and NAT gateways
- enrichers add extra metadata for S3 replication, DynamoDB PITR, EC2 ASG membership, and ElastiCache failover

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

Inference is intentionally additive, not authoritative. A few important limits:

- Stronghold only knows what the cloud APIs expose. Hidden runtime dependencies inside application code are out of scope.
- Environment-variable and naming heuristics can miss relationships or occasionally suggest a dependency that needs human review.
- Transitive dependency chains depend on inference quality, so Stronghold stays conservative in scoring and uses direct dependents only for blast-radius weighting.
- Missing permissions reduce graph fidelity. A skipped service means some downstream rules and inferred edges may also be incomplete.

In practice, inferred edges are useful for prioritization and review, but they are not a substitute for architecture knowledge from the team that owns the system.

### 4. Graph Analysis

`analyzeFullGraph()` runs several deterministic passes over the graph:

- SPOF detection
- Criticality scoring
- Redundancy analysis
- Regional concentration analysis
- Circular dependency detection
- Cascade chain analysis

SPOF detection relies on Tarjan-style articulation-point logic plus service-aware handling for cases like databases, DNS, and single-instance compute.

### 5. Validation and Scoring

Validation rules are pure functions over nodes, edges, and optional DRP context. They produce `pass`, `fail`, `warn`, `skip`, or `error` with remediation guidance.

The overall DR posture score is calculated from:

```text
weight = severityWeight × criticalityWeight × blastRadiusWeight
```

See [Scoring](./scoring.md) for the exact formula and weighting details.

### 6. DRP Generation

The DRP generator groups components into logical services and derives:

- Recovery strategy per component
- Human-readable recovery steps
- Validation probes after recovery
- Recovery order within each service
- RTO and RPO estimates, including evidence and limitations
- Effective chain-aware RTO after dependency propagation

The output is declarative YAML or JSON. It documents what should be restored and in what order; it does not execute the restore.

### 7. Drift Detection

Drift compares two scan snapshots using deterministic resource matching by ID. It flags:

- Added or removed resources
- Configuration changes that affect DR posture
- Dependency changes
- DRP staleness when a previously generated plan no longer matches the live graph

## Ports and Adapters

The core package defines domain interfaces. Adapters differ by entry point:

| Concern | CLI adapter | Server adapter |
| --- | --- | --- |
| Scan storage | Local JSON files | Prisma/PostgreSQL |
| Infrastructure storage | Local JSON files | Prisma/PostgreSQL |
| Logging | Console output | Structured server logs |

This separation is why the same validation, scoring, DRP, and drift code can run in both CLI and server contexts.

## Key Design Decisions

### Keep Core Framework-Free

`packages/core` does not depend on Express or React. That keeps the domain reusable from the CLI, the API, tests, and future integrations.

### Use Graphology-Compatible Graphs

The graph layer targets a graphology-compatible interface so algorithms stay portable and testable while still benefiting from a mature graph toolkit.

### Prefer Honest Estimates Over Fake Precision

When AWS publishes reliable timings, Stronghold can surface them. When it does not, Stronghold uses `unverified` estimates or `null` bounds rather than inventing numbers that look precise but are not trustworthy.

### Store the Community CLI State Locally

The CLI writes scan results to `.stronghold/` so users can inspect, diff, and validate locally without any telemetry requirement.

## Testing

Stronghold’s day-to-day quality gates are the repository-level scripts:

- `npm run typecheck`
- `npm run build`
- `npm run test`

Package-level coverage focuses on the core logic that most often regresses:

- Core Vitest suites cover validation, scoring, DRP generation, RTO estimation, graph behavior, and drift logic
- Server tests cover route behavior and Prisma-backed adapters
- CLI workflows are exercised through command and pipeline tests, plus demo scenarios

For documentation changes, the expected gate is still that `npm run typecheck` and `npm run build` pass at the repository root.
