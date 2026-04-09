# Governance

## Overview

Stronghold provides lightweight DR governance through `.stronghold/governance.yml`.

All top-level sections are optional:

- `ownership`
- `risk_acceptances`
- `policies`

A missing file is not an error. A present file with missing sections is also valid.

If `governance.yml` is invalid, Stronghold emits warnings and continues scanning or reporting. The dedicated `stronghold governance validate` command is the place where you can fail fast on governance problems.

## File Structure

```yaml
version: 1

ownership:
  payment:
    owner: platform-team
    contact: platform-team@company.com
    confirmed: true
    confirmed_at: "2026-03-15T10:00:00Z"
    review_cycle_days: 90

risk_acceptances:
  - id: ra-001
    finding_key: "rds-backup-enabled::payment-db"
    accepted_by: "cto@company.com"
    justification: "Migration in progress; backup configuration changes next sprint."
    accepted_at: "2026-03-20T12:00:00Z"
    expires_at: "2026-04-19T12:00:00Z"
    severity_at_acceptance: high

policies:
  - id: critical-datastores-backup
    name: "Critical datastores must have backup"
    description: "Critical datastore resources must pass backup_plan_exists."
    rule: backup_plan_exists
    applies_to:
      service_criticality: critical
      resource_role: datastore
    severity: critical
```

Important details:

- `version: 1` is required
- `ownership` is an object keyed by service id
- each policy targets one validation rule through `rule`
- risk acceptances use `finding_key` in `ruleId::nodeId` format

## Ownership

Governance derives ownership status from the YAML entry and review timing.

| Derived status | Meaning |
| --- | --- |
| `confirmed` | Owner exists and confirmation is still within the review window |
| `unconfirmed` | Owner exists but `confirmed: true` was not set |
| `review_due` | Owner was confirmed, but the review window has elapsed |
| `none` | No governance ownership entry exists for the service |

Ownership fields in `governance.yml`:

- `owner` is required for an ownership entry
- `contact` is optional
- `confirmed` is optional and defaults to `false`
- `confirmed_at` is required when `confirmed: true`
- `review_cycle_days` defaults to 90

Without a governance file, ownership can still come from `services.yml` and is shown as `(declared)`.

With a governance file present, the governed ownership view comes from `ownership`. Services without an entry are treated as `none`.

## Relationship to `services.yml`

`services.yml` and `governance.yml` serve different purposes.

- `services.yml` defines service boundaries and can carry a declared owner
- `governance.yml` defines governed ownership state, risk acceptances, and policy scope

Operationally:

- without governance, owner output can come from `services.yml` and is shown as declared
- with governance enabled, governed ownership status comes from `ownership`
- a missing governance ownership entry means the service is treated as having no governed owner

This separation keeps service modeling and governance review distinct.

## Risk Acceptance

Risk acceptance excludes an active finding from the operational score while keeping the raw score visible for comparison.

Required YAML fields:

- `id`
- `finding_key`
- `accepted_by`
- `justification`
- `accepted_at`
- `expires_at`
- `severity_at_acceptance`

Behavior:

- the acceptance is active until `expires_at`
- if `expires_at` passes, the acceptance becomes `expired`
- if the finding severity becomes worse than `severity_at_acceptance`, the acceptance becomes `superseded`
- expired or superseded acceptances no longer exclude the finding from scoring

The CLI helper enforces additional constraints:

- `stronghold governance accept` requires `--expires` between 30 and 365 days
- justification must be non-empty
- the finding must exist in the latest scan
- findings with policy violations cannot be accepted through the CLI

The report and `stronghold status` show both:

- score with acceptances applied
- score without acceptances

This keeps accepted risk visible instead of silently removing it from the posture view.

## Custom Policies

Custom policies scope existing validation rules to specific contexts. They do not create new validation rules.

Each policy contains:

- `id`
- `name`
- `description`
- `rule`
- `applies_to`
- `severity`

Scope matching is AND-based. Available scope fields are:

| Field | Example |
| --- | --- |
| `service_criticality` | `critical` |
| `resource_role` | `datastore` |
| `service_id` | `payment` |
| `tag.key` + `tag.value` | `environment` + `production` |

When a policy applies and the referenced validation rule fails for that resource, Stronghold annotates the finding with a policy violation.

Policy violations:

- do not create duplicate findings
- do not double-count in scoring
- can block CLI risk acceptance for that finding

## Validation Behavior

`stronghold governance validate` checks the current governance file against the latest effective scan.

It validates:

- ownership references to known services
- risk acceptance references to known findings
- acceptance state such as expired or superseded
- policy references to known validation rules

This command is the best place to catch stale governance after a service rename, rule rename, or major infrastructure change.

## Audit Events

Governance-related events are recorded in the audit trail.

| Event | Trigger |
| --- | --- |
| `risk_accept` | A new risk acceptance is created through the CLI |
| `risk_expire` | A previously active acceptance becomes expired |
| `risk_supersede` | A finding becomes more severe than the accepted severity |
| `ownership_confirm` | A service owner becomes confirmed |
| `ownership_review_due` | A confirmed owner reaches the next review date |
| `policy_violation` | A finding matches a custom policy violation |
| `governance_edit` | The governance file is initialized or edited through Stronghold tooling |

## CLI Commands

| Command | Description |
| --- | --- |
| `stronghold governance` | Show governance summary from the latest scan |
| `stronghold governance init` | Create a starter `.stronghold/governance.yml` |
| `stronghold governance accept` | Add a risk acceptance to the governance file |
| `stronghold governance validate` | Validate governance references against the latest scan |

## Limits

- Governance is declarative. Stronghold does not verify that an owner is reachable or that an approver has authority.
- Risk acceptance is a time-bounded organizational decision, not a permanent suppression mechanism.
- Policies scope existing validation rules only. If the validation engine lacks a rule, governance cannot invent one.
- The self-hosted server exposes governance state read-only. `POST /api/governance/accept` intentionally returns `501`.
