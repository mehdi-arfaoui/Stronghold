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
|  Discovery -> Graph -> [Overrides] -> Analysis         |
|    -> Service Detection -> [Merge services.yml]        |
|    -> Validation -> Evidence Extraction                |
|    -> Scoring (service ceiling + evidence maturity)    |
|    -> Contextual Findings (4 dimensions)               |
|    -> Recommendations                                  |
|    -> DRP Generation -> Runbooks                       |
|    -> Scenario Coverage Analysis                       |
|    -> Governance (ownership, risk, policies)           |
|    -> History (snapshots, lifecycle, debt, trends)     |
|    -> Report                                           |
|                                                        |
| Cross-cutting: Encryption | Redaction | Audit Trail    |
+--------------------------------------------------------+
|               Ports & Adapters                         |
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

### 8. Service Detection

Stronghold groups resources into logical services using multiple sources:

| Source | Confidence | Method |
| --- | --- | --- |
| Manual (`services.yml`) | `1.0` | Glob patterns against resource identifiers and ARNs |
| CloudFormation stacks | `0.9` | Stack membership, filtered to application stacks |
| Application tags | `0.75` | Tags such as `service`, `app`, `application`, `workload`, `project`, `microservice`, `component` |
| Topology clustering | `0.4-0.6` | Connected components on application dependency edges only |

Merge precedence is deterministic: manual > cloudformation > tag > topology.

Services are the unit of service-level scoring, scenario coverage, and governance. When no services are detected, Stronghold falls back to flat resource-level reporting.

### 9. Evidence Model

Validation results carry evidence metadata. Evidence does not change pass or fail status; it adjusts confidence on passing controls and surfaces the maturity of the underlying proof.

Types: `observed` (from API response), `inferred` (from graph), `declared` (manual claim), `tested` (exercise result), `expired` (stale evidence).

Evidence is extracted automatically during validation for all rules. Manual evidence can be registered with `stronghold evidence add`.

Storage is append-only in the CLI (`.stronghold/evidence.jsonl`). In the server, evidence is stored as JSON report payloads associated with the scan.

### 10. Scenario Coverage Analysis

Stronghold evaluates built-in disruption scenarios without executing against live infrastructure:

- AZ failure (per AZ)
- Region failure (only when more than one region is present)
- Single point of failure loss (ranked by blast radius)
- Data corruption (per service with datastores)

Impact propagation uses reverse BFS on application-level edges only. Infrastructure edges such as `contains`, placement, security groups, and IAM links are excluded. Cascade depth is capped at 10.

Coverage verdicts combine recovery-path existence, evidence maturity, and runbook liveness: `covered`, `partially_covered`, `uncovered`, `degraded`.

### 11. Posture Memory

Stronghold keeps compact scan snapshots in `.stronghold/history.jsonl` with a default retention of 50 snapshots.

Finding lifecycle tracking uses composite keys (`ruleId::nodeId`) to detect first-seen, resolved, persistent, and recurrent findings. DR debt is derived from finding age, severity, service criticality, and recurrence.

Trend direction compares the latest posture against the average of recent stored snapshots. The CLI uses that trend to classify posture as improving, stable, or degrading and to generate highlights such as new critical findings, expired evidence, or debt milestones.

### 12. Governance

`.stronghold/governance.yml` provides three optional sections: ownership, risk acceptances, and custom policies.

- Ownership records who is responsible for a service and whether that declaration is confirmed, unconfirmed, review due, or missing.
- Risk acceptances exclude active accepted findings from the score while keeping the raw score visible for comparison.
- Custom policies scope existing validation rules to specific services, roles, or tags and annotate violating findings.

All governance events are recorded in the audit trail. The server exposes governance state read-only; `POST /api/governance/accept` intentionally returns `501`.

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
| Evidence storage | `.stronghold/evidence.jsonl` | JSON report payloads |
| History storage | `.stronghold/history.jsonl` | JSON report payloads |
| Finding lifecycle | `.stronghold/finding-lifecycles.json` | JSON report payloads |
| Governance state | `.stronghold/governance.yml` | `GET /api/governance` (read-only) |
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
