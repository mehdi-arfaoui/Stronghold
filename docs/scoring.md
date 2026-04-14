# DR Posture Scoring

## What the Score Means

The DR Posture Score measures how much of the recommended DR mechanism set is present in the scanned infrastructure, weighted by impact.

It does not prove that:

- a real disaster will be survived
- the team can execute the plan under pressure
- the plan has been tested end to end

Only a tested recovery exercise can prove those things.

## Deterministic by Design

The score is deterministic for a given:

- scan snapshot
- Stronghold version
- validation rule set

If you run `report` twice against the same `.stronghold/latest-scan.json`, you get the same score. Scores can change when:

- infrastructure changes
- permissions expose more or less metadata
- Stronghold upgrades and the rule set or enrichers evolve

## Formula

```text
score = Σ(weight × result) / Σ(weight) × 100
```

Where:

- `result = 1.0` for `pass`
- `result = 0.5` for `warn`
- `result = 0.0` for `fail`
- `skip` and `error` are excluded from the numerator and denominator

Each check weight is:

```text
weight = severityWeight × criticalityWeight × blastRadiusWeight
```

## Severity Weight

Severity comes from the rule definition.

| Severity | Weight |
| --- | --- |
| `critical` | 4 |
| `high` | 3 |
| `medium` | 2 |
| `low` | 1 |

## Criticality Weight

Criticality comes from graph analysis. Stronghold reads `node.metadata.criticality` when present.

| Criticality | Weight |
| --- | --- |
| `critical` | 4 |
| `high` | 3 |
| `medium` | 2 |
| `low` | 1 |
| unknown / missing | 2 |

The default is intentionally conservative rather than optimistic.

## Blast Radius Weight

Blast radius uses direct dependents only.

```text
blastRadiusWeight(n) = 1                 if n = 0
blastRadiusWeight(n) = log2(n + 1)       if n > 0
```

Examples:

| Direct dependents | Weight |
| --- | --- |
| 0 | 1.00 |
| 1 | 1.00 |
| 2 | 1.58 |
| 3 | 2.00 |
| 7 | 3.00 |
| 15 | 4.00 |

Why direct-only:

- direct edges are the strongest evidence in the graph
- transitive chains depend more heavily on inference quality
- keeping scoring conservative avoids over-penalizing based on weak heuristics

## Grades

| Grade | Score range |
| --- | --- |
| `A` | 90-100 |
| `B` | 75-89 |
| `C` | 60-74 |
| `D` | 40-59 |
| `F` | 0-39 |

## Category Scores

Stronghold also computes the same weighted formula independently for:

- `backup`
- `redundancy`
- `failover`
- `detection`
- `recovery`
- `replication`

This is often more actionable than the headline score. A system with a decent overall grade can still be dangerously weak in one category such as detection or replication.

## Service-Level Scoring

When services are detected, Stronghold computes a score per service using the same weighted formula, scoped to the resources within that service.

### Severity Ceiling

A service score is capped based on its worst unresolved finding:

| Worst unresolved finding | Maximum grade | Maximum score |
| --- | --- | --- |
| `critical` | `D` | 40 |
| `high` | `C` | 60 |
| `medium` or `low` only | no extra cap | formula score |
| no unresolved findings | `A` | 100 |

This prevents a service with a critical unresolved finding from appearing healthy just because it has many passing lower-impact controls.

### Role-Aware Weighting

Within a service, resource roles affect scoring weight:

| Role | Multiplier |
| --- | --- |
| `datastore` | 2.0x |
| `compute` | 1.5x |
| other roles | 1.0x |

This reflects that losing a datastore is usually more damaging to recoverability than losing a stateless compute node.

## Evidence Maturity Scoring

For passing rules, the score credit is adjusted by the confidence of the strongest supporting evidence:

| Evidence type | Confidence | Score credit for a pass |
| --- | --- | --- |
| `tested` | 1.0 | 100% |
| `observed` | 0.85 | 85% |
| `declared` | 0.7 | 70% |
| `inferred` | 0.5 | 50% |
| `expired` | 0.2 | 20% |

Failing rules always contribute `0` regardless of evidence. Warning results still contribute `0.5` as defined in the base formula.

Use `stronghold report --explain-score` to see the per-rule decomposition. The report also shows the potential score if all passing controls had current `tested` evidence.

## Risk Acceptance and Scoring

When a finding is covered by an active risk acceptance, it is excluded from the score. The report displays two scores:

- `Score` with acceptances applied: the operational score
- `Score without acceptances`: the raw score as if no findings were accepted

This makes the impact of risk acceptances visible instead of hiding it. Expired or superseded acceptances re-activate the finding and it counts against the score again.

In the CLI workflow, findings with policy violations cannot be accepted until the policy scope is removed or the finding is fixed.

## DR Debt

DR debt is a separate metric from the score. It measures accumulated unresolved recovery risk over time:

```text
debt = ageInDays × severityFactor × serviceCriticalityFactor × recurrenceMultiplier
```

Where:

- `severityFactor`: critical=`4`, high=`2`, medium=`1`, low=`0.5`
- `serviceCriticalityFactor`: critical=`4`, high=`2`, medium=`1`, low=`0.5`
- `recurrenceMultiplier`: `1.5x` if the finding was resolved and later re-appeared

Debt is summed across active findings and reported per service and globally. Service debt direction is derived from the previous stored debt snapshot with a 10% tolerance band (`increasing`, `stable`, `decreasing`).

## Proof-of-Recovery

Proof-of-recovery measures the percentage of critical services where at
least one DR mechanism has been validated by a real test (evidence type
`tested`, non-expired).

```text
proof_of_recovery = critical services with tested evidence / critical services × 100
```

This metric is distinct from the DR posture score. The score measures
configuration completeness. Proof-of-recovery measures whether recovery
has been proven.

Stronghold reports both metrics together:

- **Proof-of-recovery (tested):** percentage backed by real exercise evidence
- **Observed coverage:** percentage backed by configuration observation

The contrast between the two reveals the gap between "config exists"
and "recovery was proven." A system with 0% tested and 73% observed has
configuration in place but no proof it works.

Proof-of-recovery is tracked in scan history and included in trend analysis.

## Reality Gap

The reality gap measures the distance between what configuration checks
report and what Stronghold can actually prove.

```text
claimed_protection = (passing + warning) / (passing + warning + failing) x 100
proven_recoverability = fully_proven_services / critical_services x 100
reality_gap = claimed_protection - proven_recoverability
```

A service is "fully proven recoverable" when it meets all of:

- at least one passing rule has non-expired `tested` evidence
- all critical scenarios for the service are `covered` or `partially_covered`
- the service runbook is valid with no stale resource references
- the service has no unmitigated SPOF with blast radius greater than `2`

The claimed protection value is intentionally unweighted. It represents
the naive number a config-only tool would report. The reality gap shows
how much of that claim is unsupported by tested recovery proof.

## Transparency in Reports

Each validation result includes the raw score inputs:

- `severityWeight`
- `criticalityWeight`
- `blastRadiusWeight`
- `directDependentCount`

The report also includes:

- the scoring method string
- a disclaimer explaining what the score does and does not guarantee
- per-category scores
- the weakest category

## Reliability and Limits

The score is reliable as a comparative posture signal when you keep these limits in mind:

- it depends on scan completeness
- skipped services reduce coverage
- inferred dependencies improve prioritization but are not perfect architecture truth
- a high score still needs recovery testing

Use the score to prioritize work and track improvement over time, not as a substitute for DR exercises.
