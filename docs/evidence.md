# Evidence Model

## Overview

Stronghold distinguishes between "a configuration exists" and "recovery has been proven." Evidence classifies the strength of proof behind each DR claim.

Evidence does not change whether a rule passes or fails. It changes how much confidence Stronghold gives to a passing result and makes that confidence visible in reports.

This matters because a passing control observed in AWS metadata is not the same thing as a recovery path that was exercised recently.

## Evidence Types

| Type | Confidence | Source | Default expiration |
| --- | --- | --- | --- |
| `tested` | `1.0` | Manual DR exercise result | 90 days |
| `observed` | `0.85` | Captured directly from scan metadata | none |
| `declared` | `0.7` | Manual claim without proof | 180 days |
| `inferred` | `0.5` | Derived from graph relationships or fallback logic | none |
| `expired` | `0.2` | Any stale evidence after expiration | n/a |

`expired` is not a separate source of proof. It is the degraded state of evidence that is no longer current enough to trust at its original strength.

## Automatic Extraction

Evidence is extracted automatically during validation for both passing and failing rules.

Each evidence record carries:

- `key`: the metadata field or observation name
- `value`: the observed value
- `expected`: the expected value when the rule defines one
- `timestamp`: when the evidence was captured

Stronghold uses two extraction layers:

1. Rule-level extraction through `observedKeys` declared on the validation rule.
2. Fallback extraction for rules without explicit key hints.

This keeps reports explainable even when a rule is backed by inferred graph context rather than one direct AWS field.

## Manual Registration

Register evidence from a real DR exercise with the CLI:

```bash
stronghold evidence add \
  --node payment-db \
  --type restore-test \
  --result success \
  --duration "15 min" \
  --author "jane@company.com"
```

This command records `tested` evidence.

If `--author` is omitted, the CLI tries to resolve the AWS caller identity and falls back to `unknown` if it cannot. In reports, manual test evidence is rendered as self-declared, with the executor shown when available.

The CLI currently exposes manual registration for `tested` evidence only. The `declared` type exists in the model, but there is no separate `stronghold evidence declare` command.

## Freshness

Freshness is tracked per evidence record.

| Status | Meaning |
| --- | --- |
| `fresh` | Within its validity window, or no automatic expiration applies |
| `expiring_soon` | 14 days or fewer remain before expiration |
| `expired` | The evidence is past its expiration date |

Default expiration rules:

- `tested`: 90 days from `timestamp` unless an explicit `expiresAt` is set
- `declared`: 180 days from `timestamp` unless an explicit `expiresAt` is set
- `observed` and `inferred`: no automatic expiration

Expired evidence is retained in the store. Stronghold does not delete it; it materializes the evidence as type `expired` when freshness is evaluated.

## Reading Evidence in Reports

Evidence appears directly on findings and passing controls.

For non-test evidence, Stronghold shows the observed key and value. For test evidence, it shows:

- test type
- result
- execution date
- optional duration
- optional executor
- freshness state

This is meant to answer "why does Stronghold believe this control passed?" without requiring the reader to inspect the raw scan artifact.

The report can also summarize evidence maturity across the whole posture:

- how many controls are backed by `tested` evidence
- how many are only `observed`
- how many are already `expired`

That summary is a useful way to distinguish "configured" from "proven."

## Storage

CLI storage:

- `.stronghold/evidence.jsonl`
- append-only JSONL
- local only

Server storage:

- JSON report payloads associated with a scan
- exposed through `GET /api/evidence`
- exposed through `GET /api/evidence/expiring`
- manual test evidence accepted through `POST /api/evidence`

Evidence records are not deleted automatically. The model is append-only for auditability.

## API Shape for Manual Tests

The self-hosted server accepts manual test evidence through `POST /api/evidence`.

The request body includes:

- `nodeId`
- `type`
- `result`
- optional `duration`
- optional `notes`
- optional `serviceId`
- optional `expiresDays`
- optional `author`

Both the API and the CLI allow per-record expiration overrides for manual test evidence. If no override is provided, Stronghold defaults to 90 days for `tested` evidence.

## Scoring Impact

For passing rules, score credit is scaled by the strongest evidence confidence attached to that rule result:

- `tested`: full credit
- `observed`: 85% credit
- `declared`: 70% credit
- `inferred`: 50% credit
- `expired`: 20% credit

Failing rules always contribute `0` regardless of evidence. Warning results still contribute `0.5` as part of the base scoring model.

Use `stronghold report --explain-score` to inspect the per-rule score decomposition. The report also shows the potential score if all current passing controls were backed by current `tested` evidence.

See [Scoring Methodology](./scoring.md) for the underlying formula.

## Operational Use

In practice, evidence is most useful in three cases:

1. Distinguishing a control seen in metadata from a control proven in an exercise.
2. Surfacing stale proof before a governance review or DR exercise cycle.
3. Explaining why a service with many passing rules still does not receive full score credit.

If your team only records `observed` evidence, Stronghold will treat the posture as partially trusted rather than fully proven.

## What Evidence Does Not Do

Evidence makes the posture more explainable and more honest, but it has clear boundaries.

Evidence does not:

- change a failing rule into a passing one
- prove application correctness after restore
- prove people, vendors, or downstream organizations will respond correctly
- replace DR exercises

Stronghold uses evidence to describe confidence in what it can see, not to make claims beyond the scope of the recorded proof.

## CLI Commands

| Command | Description |
| --- | --- |
| `stronghold evidence add` | Register manual test evidence |
| `stronghold evidence list` | List all evidence records |
| `stronghold evidence show <id>` | Show one evidence record in detail |
| `stronghold report --explain-score` | Show score decomposition with evidence maturity |
| `stronghold report --show-passed` | Include passing controls and their evidence |
| `stronghold status` | Show evidence alerts such as expiring or expired tests |

## Limits

- Evidence proves that a control was observed or tested at a point in time. It does not prove full service recovery under every failure mode.
- Automatic extraction only covers what AWS APIs and the graph model expose.
- Application-level recovery behavior still requires current `tested` evidence from real exercises.
- `declared` evidence is weaker than `observed` evidence by design because it is a claim rather than a direct observation.
- Manual CLI registration records `tested` evidence only. If you need a different evidence source, it must come from the scan pipeline or code changes.
