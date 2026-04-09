# Posture History

## Overview

Stronghold keeps a local memory of DR posture evolution. Instead of storing only full scan artifacts, it stores compact posture snapshots and finding lifecycle state so it can derive trends, ages, DR debt, and highlights over time.

This is intended for temporal analysis, not for reconstructing the entire scanned infrastructure from history alone.

## Scan History

Each scan appends a compact snapshot to `.stronghold/history.jsonl`.

Default retention is 50 snapshots.

Each snapshot contains posture metrics such as:

- global score and grade
- total resource count
- finding counts by severity
- scenario coverage counts
- evidence distribution
- service-level scores and finding counts
- regions and scan timing metadata
- governance summary counts when governance is present

Snapshots are stored as JSONL entries and replaced in place for the latest record when DR debt is added after lifecycle calculation.

## Service-Level History

History is not only global. Each snapshot also keeps a compact per-service record containing:

- service id
- service name
- score
- grade
- finding count
- critical finding count
- resource count
- optional debt once debt has been calculated

This is what powers `stronghold history --service <id>` and the per-service trend output used by the CLI and server APIs.

## Finding Lifecycle

Findings are tracked across scans using the composite key:

```text
ruleId::nodeId
```

Lifecycle statuses are:

| Status | Meaning |
| --- | --- |
| `active` | Present in the current scan and not previously resolved |
| `resolved` | Present before, absent now |
| `recurrent` | Previously resolved, then seen again |

Each lifecycle record carries:

- `firstSeenAt`
- `lastSeenAt`
- `resolvedAt` when applicable
- `recurrenceCount`
- `ageInDays`
- optional service context

Storage path:

- `.stronghold/finding-lifecycles.json`

## DR Debt

DR debt quantifies accumulated unresolved recovery risk:

```text
debt = ageInDays × severityFactor × serviceCriticalityFactor × recurrenceMultiplier
```

Factors used by the code:

- `severityFactor`: critical=`4`, high=`2`, medium=`1`, low=`0.5`
- `serviceCriticalityFactor`: critical=`4`, high=`2`, medium=`1`, low=`0.5`
- `recurrenceMultiplier`: `1.5x` for recurrent findings

Debt is computed per active finding, then summed per service and globally.

Service debt direction is classified from the previous stored debt snapshot:

- `increasing` when current debt is more than 10% above the previous value
- `decreasing` when current debt is more than 10% below the previous value
- `stable` otherwise

## Trends

Global posture trend is derived from stored snapshots.

The current implementation compares the latest value against the average of recent prior values:

- score trend
- finding count trend
- scenario coverage trend
- evidence trend for `tested` and `expired`

Trend directions are:

| Trend | Meaning |
| --- | --- |
| `improving` | Latest score is materially above the recent baseline |
| `stable` | No significant movement |
| `degrading` | Latest score is materially below the recent baseline |

The first stored scan is treated as an initial baseline. Trend classification becomes meaningful after additional scans accumulate.

## Retention and Replacement

History retention is append-and-trim:

- new snapshots are appended
- once the retention limit is exceeded, the oldest snapshots are dropped

This keeps local posture memory bounded without requiring a separate maintenance job.

The current snapshot can also be rewritten after the initial append when additional derived metrics such as debt are attached.

## Highlights

Stronghold derives up to 10 highlights from recent posture changes and sorts them by severity.

Current highlight types are:

- `score_improved`
- `score_degraded`
- `new_critical_finding`
- `critical_resolved`
- `scenario_uncovered`
- `scenario_covered`
- `evidence_expired`
- `debt_milestone`
- `finding_recurrent`
- `first_scan`

These highlights are used by `stronghold status` to surface the most important recent posture changes without requiring a full timeline review.

## CLI Commands

| Command | Description |
| --- | --- |
| `stronghold history` | Show the posture history timeline |
| `stronghold history --service payment` | Show history for one service |
| `stronghold history --limit 10` | Limit the number of history entries |
| `stronghold history --json` | Emit JSON instead of terminal output |
| `stronghold status` | Show current trend, debt, highlights, and oldest findings |
| `stronghold report --show-resolved` | Include recently resolved findings in the report |

## Limits

- History is local to the CLI. In the self-hosted server, history is exposed from JSON report payloads attached to scans rather than separate relational tables.
- History snapshots are compact posture records, not full scan exports.
- Finding lifecycle depends on stable `ruleId::nodeId` keys. If a resource is replaced and gets a new identifier, the old finding resolves and the new one appears as a new finding.
- Trend direction is only as useful as the amount of stored history. A single snapshot gives you a baseline, not a trend.
