# Stronghold — Architecture

## Product model

Stronghold is a **service-centric** DR intelligence system. The unit of value is the **service** (a logical group of resources that together deliver a business capability), not the individual resource.

A SRE thinks "is my payment service protected?" not "is my RDS instance backed up?"

Resources are discovered by scanners. Services are detected on top of resources via CloudFormation stacks, tags, topology, or manual declaration. Findings, scores, recommendations, and reports are organized by service.

## Pipeline

```
Scan → Graph construction → [Overrides] → Analysis → Service Detection → Merge services.yml
    → DR Validation → Evidence Extraction
    → Scoring (global + per-service, severity ceiling, evidence maturity)
    → Contextual Findings (4 dimensions)
    → Recommendations (risk from runbook strategies)
    → DRP Generation → Runbooks
    → Scenario Coverage Analysis
    → Governance (ownership, risk acceptance, custom policies)
    → History (snapshot, finding lifecycle, debt, trends, highlights)
    → Report
                                                  ↓
                                            Drift Detection → DRP Impact Analysis

Cross-cutting: Encryption (AES-256-GCM) | Redaction | Audit Trail | Config Loader
```

### Pipeline execution order

1. Scan: bounded concurrency within a region (default 5), regions sequential
2. Retry on ThrottlingException / TooManyRequestsException (3 attempts, exp backoff, jitter)
3. Per-scanner timeout via AbortSignal (default 60s)
4. Single scanner failure does not stop scan (Promise.allSettled)
5. Overrides applied after graph construction, before analysis
6. Service detection runs after analysis, before validation scoring
7. Evidence extraction runs after DR validation, before scoring
8. Governance runs after scenario coverage
9. Posture history persists after governance
10. Audit entry logged for every command execution

## Key paths

```
packages/core/src/
├── providers/aws/           # 16 scanners + orchestrator + assume-role + client factory
├── providers/aws/services/  # Individual service scanners (ec2, rds, aurora, s3, lambda, etc.)
├── graph/                   # graphology graph engine, dependency inference, criticality scoring
├── graph/graph-visual.ts    # Graph data transformer for visual export
├── graph/graph-html-renderer.ts  # Standalone HTML graph generator
├── graph/overrides/         # Override loader, applier, types
├── services/                # Service detection, scoring, finding contextualizer, impact templates
├── services/detection-strategies/  # CloudFormation, tag, topology detection strategies
├── validation/              # ~39 DR rules, 6 categories, scoring engine
├── evidence/                # Evidence types, extractor, store, freshness, merger
├── governance/              # Governance loader, ownership resolver, risk acceptance, custom policies
├── history/                 # Scan snapshots, finding lifecycle tracking, debt, posture trends
├── scenarios/               # Scenario coverage analysis, disruption impact propagation
├── recommendations/         # Recommendation engine, risk classifier (reads from strategies)
├── drp/                     # DRP generator, recovery strategies (13 via registry), runbooks
├── reasoning/               # Reasoning engine, chain builder, graph insights
├── scoring/                 # reality-gap.ts, recovery-chain.ts
├── encryption/              # AES-256-GCM encrypt/decrypt
├── redaction/               # Redaction engine + redactObject
├── audit/                   # AuditLogger port, FileAuditLogger, AuditEntry types
├── config/                  # Config loader for .stronghold/config.yml
└── types/                   # All shared types
```

## Design decisions

### Scoring

- Service grade capped by worst unresolved finding severity: Critical → D max (≤40), High → C max (≤60)
- Scoring uses log2 of direct dependents only, not transitive (at global level)
- Evidence does not change pass/fail — adjusts confidence on passing rules only
- Evidence taxonomy: observed (0.85), inferred (0.5), declared (0.7), tested (1.0), expired (0.2)
- Reports show score with and without risk acceptances when governance is present

### Reality Gap

- `Reality Gap = claimedProtection - provenRecoverability`
- claimedProtection = unweighted pass rate (intentionally naive)
- provenRecoverability requires: tested evidence + covered scenarios + valid runbook + no unmitigated SPOF

### Recovery Chain

- Full-chain traces topological recovery order per service
- Each step evaluated as proven/observed/blocked/unknown
- Steps weighted by role: datastore=4, compute=3, storage=2, network=1, other=1
- Recovery order from DRP when available, else datastore-first default
- Disclaimer "AWS-visible infrastructure only" always present

### Graph Insights

- Types: cascade_failure, silent_dependency_drift, risk_acceptance_invalidation, recovery_path_erosion
- Require a previous scan for temporal analysis — without history, omitted silently
- Reasoning steps are composable building blocks, not monolithic templates
- Report reasoning limited to 3 worst services, max 4 bullets each

### Service Detection

Three strategies in priority order (higher-confidence strategy wins):
1. CloudFormation stacks (confidence 0.9): only application-stacks become services
2. Application tags (confidence 0.75): tags `service`, `app`, `application`, `workload`, `project`. Name-prefix detection at 0.6.
3. Topology clustering (confidence 0.4-0.6): connected component analysis on application-level edges only (no infra edges)

Manual services from `services.yml` have confidence 1.0.

### Governance

- Via `.stronghold/governance.yml` — all sections optional, missing file is OK
- Ownership status: confirmed/unconfirmed/review_due/none. Default review cycle 90 days
- Governance ownership overrides services.yml ownership
- Risk acceptance: mandatory fields are finding_key, justification, accepted_by, expires_at, severity_at_acceptance
- Expiration range: 30-365 days. Expired acceptance re-activates finding in scoring.
- Superseded acceptance (severity changed) re-activates finding
- Policy-violating findings cannot be risk-accepted
- Custom policies scope existing rules via AND-based matching
- All governance actions recorded in audit trail

### History & Lifecycle

- Scan snapshots are compact metrics (~5KB), never full scan data
- Finding lifecycle keys: `ruleId::nodeId` (never change this format)
- DR debt = ageInDays × severityFactor × serviceCriticalityFactor × recurrenceMultiplier(1.5x)
- severityFactor: critical=4, high=2, medium=1, low=0.5
- serviceCriticalityFactor: critical=4, high=2, medium=1, low=0.5
- Posture trend uses comparison with previous snapshot (10% tolerance), not rolling average
- History retention: 50 snapshots default
- Highlights capped at 10, sorted by severity

### DRP & Runbooks

- DRP-as-Code in YAML
- 13 recovery strategies via registry
- Runbooks generate executable commands, never execute
- Drift detection compares current vs baseline with DRP impact analysis
- Risk classification co-located with runbook strategies (each strategy declares its executionRisk)
- Dangerous recommendations never in top 3

### Encryption & Redaction

- AES-256-GCM for scan data encryption
- Redaction engine for safe fixture export
- No credentials in logs or state files

### Local state

All state under `.stronghold/` in working directory:

| File | Purpose |
|------|---------|
| `latest-scan.json` | Last scan result |
| `baseline-scan.json` | Drift baseline |
| `config.yml` | Scan configuration |
| `services.yml` | Manual service definitions |
| `overrides.yml` | Graph overrides (mandatory `reason` field) |
| `governance.yml` | Ownership, risk acceptances, custom policies |
| `evidence.jsonl` | Evidence store (append-only) |
| `audit.jsonl` | Audit trail (append-only, always on) |
| `history.jsonl` | Scan history snapshots |
| `finding-lifecycles.json` | Finding lifecycle tracking |

`.stronghold/.gitignore` excludes `*` by default.