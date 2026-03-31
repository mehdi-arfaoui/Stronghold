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
