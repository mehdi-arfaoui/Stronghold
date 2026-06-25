# Evidence Playbook

Version: 1

## Rules

- Evidence is append-only.
- Tested evidence is stronger than observed, declared, or inferred evidence.
- Measured RTO/RPO values must be attached to tested evidence to prove recovery objectives.
- Expired or missing measured tested evidence cannot satisfy contracts.
- Evidence evaluation is pure domain logic and must not import or call network clients.
- Audit metadata must not log credentials or sensitive infrastructure data.

## Checkpoints

- Do not mutate or delete existing evidence entries.
- Do not execute runbook commands as evidence.
- Use native `stronghold evidence add` when registering evidence.
- Do not trust RTK summaries for evidence truth.
