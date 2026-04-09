# Service Model

## Overview

Stronghold groups cloud resources into services: logical workloads that must recover together to restore a business capability.

A service is not a resource type. Grouping all RDS instances into one bucket is not a valid service model unless those resources actually recover as one workload.

Service grouping affects:

- service-level DR scoring
- scenario coverage analysis
- governance ownership and risk acceptance views
- report structure and prioritization

When ownership is shown from `services.yml`, it is a declared owner only. Verification state comes from [Governance](./governance.md) when governance is enabled.

## What Belongs in a Service

A service should usually include the resources that must be restored or failed over together.

Typical members:

- application compute
- primary datastores
- service-specific queues or topics
- service-specific storage buckets
- DNS or routing resources dedicated to that workload

Typical non-members unless they are truly workload-specific:

- shared VPC primitives
- shared IAM roles and policies
- generic security groups
- organization-wide observability resources

This is why Stronghold filters infrastructure-only groupings out of the higher-confidence detection stages.

## Detection Sources

Stronghold combines four sources in a fixed precedence order.

| Source | Confidence | Description |
| --- | --- | --- |
| Manual `services.yml` | `1.0` | Explicit service definitions with resource patterns |
| CloudFormation | `0.9` | Stack membership for application stacks |
| Application tags | `0.75` | Tags such as `service`, `app`, `application`, `workload`, `project`, `microservice`, `component` |
| Topology clustering | `0.4-0.6` | Connected components on application dependency edges |

Higher-precedence assignments win. A resource is assigned at most once.

### CloudFormation Detection

Stronghold reads the `aws:cloudformation:stack-name` tag and groups resources by stack.

Only application stacks become services. Infrastructure-only stacks are excluded. In practice, stacks containing only VPC, subnet, IAM, security group, or similar infrastructure resources are treated as infrastructure, not workloads.

CloudFormation detection is usually the cleanest source because stack membership is explicit and low-noise.

### Tag Detection

Stronghold looks for workload-oriented tags in this priority order:

- `service`
- `app`
- `application`
- `workload`
- `project`
- `microservice`
- `component`

Resources with the same tag value are grouped into one service.

If no preferred service tag is present, Stronghold also tries a weaker fallback based on the `Name` tag. When at least three unassigned resources share a common name prefix, Stronghold can create a service from that prefix with lower confidence.

Generic organization-wide tags can create noisy groupings. The most common example is a broad `Project` tag applied through Terraform `default_tags`. In those cases, use manual definitions to override the result.

### Topology Detection

When stronger signals are absent, Stronghold clusters the dependency graph using application edges only:

- `depends_on`
- `triggers`
- `publishes_to`
- `subscribes_to`
- `connects_to`
- `routes_to`

Infrastructure edges are excluded from clustering. `contains`, security group relationships, placement edges, and IAM access edges do not define workload boundaries.

Topology detection is best-effort. It is useful as a fallback, but the confidence is intentionally lower because graph connectivity alone is not enough to prove service boundaries.

### Manual Definition

Create `.stronghold/services.yml` to define or override services explicitly:

```yaml
version: 1

services:
  payment:
    name: Payment Service
    criticality: critical
    owner: platform-team
    resources:
      - "arn:aws:rds:*:*:db:payment-*"
      - "arn:aws:lambda:*:*:function:payment-*"
      - "arn:aws:sqs:*:*:payment-*"
```

Important details:

- `version: 1` is required
- `services` is an object keyed by service id
- each service must define `name`, `criticality`, and at least one `resources` pattern
- `owner` is optional and treated as declared information

Patterns are matched against the resource identifiers Stronghold knows about, typically resource IDs and ARNs collected during the scan.

Manual definitions have confidence `1.0` and override all auto-detected sources.

## Service IDs and Names

Every service has:

- an `id`, used by CLI commands and governance references
- a human-readable `name`

For auto-detected services, the `id` is derived from the detected name. For manual services, the YAML object key is the service id and should be treated as stable once governance, history, or automation depends on it.

In practice:

- use short, stable ids such as `payment`, `auth`, `reporting`
- use `name` for readable display text such as `Payment Service`
- avoid renaming service ids casually, because history and governance references are keyed to them

## Merge Logic

Merge precedence is fixed:

```text
manual > cloudformation > tag > topology
```

Rules of the merge:

- a resource can belong to only one service
- if two manual services match the same resource, Stronghold treats it as a configuration error
- manual patterns that match no resources produce warnings
- new resources matched by glob patterns are flagged so they can be reviewed before they are silently trusted

This keeps service assignment deterministic across runs.

## Pattern Matching Notes

Manual `resources` entries are matched against the resource references Stronghold collected during the scan.

That usually means:

- resource ids
- ARNs
- other normalized references attached to the node

Operational consequences:

- an exact string is matched exactly
- a `*` glob broadens the match
- a pattern that matches nothing generates a warning
- a broad pattern can start matching newly discovered resources in future scans

That last case is why Stronghold flags new glob matches instead of silently trusting them.

## Scoring Impact

Services affect scoring in two ways.

First, each detected service gets its own score, grade, finding counts, and coverage gaps.

Second, service scoring applies two service-specific constraints:

1. Severity ceiling. A service with an unresolved `critical` finding is capped at `40` (`D` max). A service with an unresolved `high` finding is capped at `60` (`C` max).
2. Role-aware weighting. `datastore` resources count `2.0x`, `compute` resources count `1.5x`, and other roles count `1.0x`.

See [Scoring Methodology](./scoring.md) for the exact scoring formula.

## Unassigned Resources

Resources that do not match any service remain unassigned.

Unassigned resources still contribute to the global score and appear in flat findings. They do not contribute to any one service's score or scenario detail.

This is intentional. Stronghold prefers leaving a resource unassigned over guessing a service boundary with unjustified confidence.

## Fallback Behavior

If zero services are detected, Stronghold falls back to resource-level reporting.

In that mode:

- the overall DR score still works
- findings and recommendations still work
- service-level views are omitted
- the CLI suggests running `stronghold services detect` or creating `.stronghold/services.yml`

## Reviewing Detection Results

A practical review flow is:

1. Run `stronghold scan`.
2. Run `stronghold services detect` to inspect the current detection result.
3. Run `stronghold services list` to compare criticality, owner, and score by service.
4. Run `stronghold services show <id>` on suspicious or noisy groupings.
5. Write or edit `.stronghold/services.yml` when the auto-detected boundary is wrong.

If Stronghold warns that new resources matched an existing manual glob, review that service before treating the match as intended. This is especially important after refactors, renames, or Terraform module expansion.

## CLI Commands

| Command | Description |
| --- | --- |
| `stronghold services detect` | Detect services from the latest saved scan |
| `stronghold services list` | Show the merged service view |
| `stronghold services show <id>` | Show one service with score, findings, owner, and resources |

`services detect` can also write `.stronghold/services.yml` from the current detection result to give you a reviewable starting point.

## Limits

- Service detection depends on scan completeness. Missing AWS permissions reduce signal quality.
- Tag-based grouping is only as good as the tagging discipline in the account.
- Topology clustering can be noisy on small graphs or on graphs with many shared infrastructure edges.
- Shared `Project` tags can create false workload groupings.
- Manual patterns match what Stronghold discovered in the scan. If a resource is missing from discovery, it cannot be assigned to a service.
- Owners in `services.yml` are declared only. Stronghold does not verify reachability, team membership, or approval authority from this file alone.
- Auto-detected service ids are derived from names. If two independent detection sources normalize to the same id, review the merged output carefully before persisting it.
