# Scenario Coverage Analysis

## Overview

Stronghold evaluates how well services survive plausible disruption scenarios. It does not execute tests against live infrastructure. It analyzes the current graph, DR plan, evidence, and runbook state to assess coverage.

The term used in Stronghold is `scenario coverage analysis`.

This analysis answers a practical question: if a realistic failure happens in the currently scanned topology, does Stronghold see a recovery path for the affected service?

## Built-in Scenarios

Stronghold generates built-in scenarios from the latest scan result.

| Scenario type | Generated from | Typical count |
| --- | --- | --- |
| AZ failure | Each availability zone with scanned resources | 1 per AZ |
| Region failure | Regions present in a multi-region scan | 0 or more |
| SPOF failure | Graph analysis single points of failure ranked by blast radius | up to all identified SPOFs, top 10 in the default set |
| Data corruption | Each service with datastore resources | 1 per qualifying service |

Two limits shape the default output:

- the default displayed scenario set is capped at 20
- SPOF scenarios contribute at most 10 entries to that default set

The full scenario catalog can still contain more entries than the default set.

## Default Set vs Full Catalog

Stronghold stores the full generated scenario list, but not every scenario is part of the default set shown by the high-level summary.

Use:

- `stronghold scenarios` for the default operational view
- `stronghold scenarios list` for the full catalog

This separation keeps the default output focused on the most actionable failures while still letting you inspect lower-priority scenarios when needed.

## Generation Rules

Built-in scenario generation is deterministic for a given scan.

Generation rules worth knowing:

- AZ scenarios are created from availability zone placement seen in the scanned nodes
- region scenarios are only created when more than one region is present in the scan
- SPOF scenarios come from graph analysis output rather than ad hoc pattern matching
- data corruption scenarios are only created for services that contain datastore resources

If the scan misses a dependency or a resource because of permissions or discovery gaps, scenario generation inherits that limitation.

## Impact Propagation

For each scenario, Stronghold first marks the directly affected nodes, then propagates impact through the dependency graph.

Propagation rules:

- method: reverse BFS over application dependency edges
- edge types included: `depends_on`, `triggers`, `publishes_to`, `subscribes_to`, `connects_to`, `routes_to`
- edge types excluded: `contains`, placement edges, security group edges, IAM edges, and other infrastructure-only links
- cascade depth cap: 10 hops

Service impact is then summarized from the affected resources:

- a service is `down` if a `compute` or `datastore` resource is affected, or if all of its resources are affected
- a service is `degraded` when only non-critical resources are affected
- a service is `unaffected` when none of its resources are reached by the scenario

## How Recovery Paths Are Judged

Coverage does not come only from impact propagation. Stronghold also asks whether the affected service has an adequate recovery path in the DRP for that kind of disruption.

Current recovery-path checks include:

- `az_failure`: surviving critical capacity in another AZ plus a failover-style DRP path
- `region_failure`: surviving critical capacity in another region plus mapped DRP components
- `data_corruption`: a restore-oriented DRP path such as `restore_from_backup`
- `node_failure`: a mapped DRP component that covers recovery or replacement of the failed node

If the DRP does not cover the affected service at all, the scenario is `uncovered` even when the graph impact is otherwise easy to understand.

## Coverage Verdicts

Each scenario receives a coverage verdict that combines recovery-path existence, evidence maturity, and runbook liveness.

| Verdict | Meaning |
| --- | --- |
| `covered` | Recovery path exists and has current `tested` evidence |
| `partially_covered` | Recovery path exists, but only weaker or stale evidence is available |
| `uncovered` | No viable recovery path is identified for the affected service |
| `degraded` | Recovery path exists, but the runbook references stale resources |

Important nuance:

- if no DRP exists, affected services are `uncovered`
- if a DRP exists but there is no recent test, the result is usually `partially_covered`
- if a runbook points to resources that no longer match the current scan, the result becomes `degraded`

## Runbook Liveness

Scenario evaluation includes runbook validation.

A runbook is considered not alive when it references resources that:

- no longer exist
- were replaced
- changed enough that the reference is stale

In that case, Stronghold does not ignore the runbook. It marks the relevant scenario coverage as `degraded` so the stale procedure is visible.

## Relationship to Services

Scenario coverage is service-centric.

That means:

- scenarios affect resources
- affected resources roll up to services
- coverage verdicts are judged per affected service
- the scenario summary then rolls those per-service verdicts up into one scenario verdict

If no services are detected, Stronghold still computes the raw scenario model, but the most useful service-level interpretation is unavailable.

## Scenario Impact on Findings

Contextual findings carry a `scenarioImpact` field.

That field links a finding to:

- the scenarios affected by the finding
- the worst-case operational outcome Stronghold derived for those scenarios

This is how a low-level validation gap becomes readable in operational terms. For example, a datastore backup failure can be connected to a data corruption scenario instead of appearing as an isolated configuration problem.

## Reading Scenario Detail Output

`stronghold scenarios show <id>` is the best view when you want to understand one failure mode end to end.

That view is useful for answering:

- which nodes were directly disrupted
- which downstream nodes were affected by dependency propagation
- which services are down versus degraded
- whether the DRP and runbook still describe a live recovery path
- what evidence maturity supports the coverage verdict

## Interpreting Uncovered vs Degraded

`uncovered` and `degraded` are different operational problems.

- `uncovered` means Stronghold could not identify a viable recovery path for the affected service.
- `degraded` means Stronghold did identify a path, but the associated runbook no longer lines up with the current infrastructure.

This distinction matters when prioritizing work:

- `uncovered` usually means missing resilience design or missing DRP coverage
- `degraded` usually means stale operational documentation or stale runbook references

## Using Scenario Results

Scenario coverage is most useful when reviewed alongside:

- service scores from `stronghold services list`
- evidence maturity from `stronghold report --explain-score`
- stale or expiring tests surfaced by `stronghold status`

A common workflow is:

1. review uncovered scenarios first
2. then review degraded scenarios caused by stale runbooks
3. then review partially covered scenarios where recovery exists but is not backed by recent tests

## CLI Commands

| Command | Description |
| --- | --- |
| `stronghold scenarios` | Show the default scenario coverage summary |
| `stronghold scenarios list` | Show the complete scenario catalog |
| `stronghold scenarios list --default-only` | Show only the default scenario set |
| `stronghold scenarios show <id>` | Show impact chain and coverage details for one scenario |

The scan summary and `stronghold status` also surface scenario coverage counts and alerts.

## Limits

- Scenario coverage depends on the scanned model. Hidden application dependencies outside AWS metadata are out of scope.
- Region failure scenarios are only generated when the scan contains more than one region.
- A recovery path in the DRP is necessary but not enough for a strong verdict. Without current `tested` evidence, Stronghold will not label it `covered`.
- Scenario analysis does not model human coordination, vendor dependencies, or business process recovery outside the scanned infrastructure graph.
- The default cap of 20 scenarios keeps output readable, but it can hide lower-priority long-tail failures from the default view.
