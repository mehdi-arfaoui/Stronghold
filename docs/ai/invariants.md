# Stronghold AI Invariants

Version: 1

These invariants are shared by all repository agents.

## Recovery Contracts

- No estimated/fallback RTO/RPO can satisfy contracts.
- No `estimatedRTO`, `suggestedRTO`, `validatedRTO`, `estimatedRPO`, or `suggestedRPO` value may be used as contract proof.
- Missing measured tested evidence means UNKNOWN.
- Missing measured tested evidence for RTO/RPO means UNKNOWN.
- Fallback values such as 120, 60, or 30 minutes must not be used to satisfy contracts.

## Side Effects

- Pure-domain modules are network-free: contracts, evidence evaluation, scenario evaluation, validation, and related business-logic modules.
- Provider, auth, and orchestration modules are explicit effect boundaries excluded from the pure-domain network guard.
- AWS access is read-only.
- Hooks and integrations live outside pure domain modules and execute outside deterministic core evaluation.
- Runbooks generate commands; they never execute them.

## Reasoning

- Stronghold is service-centric: services represent business capabilities, not resource types.
- Verdicts are deterministic: same inputs produce the same output.
- No LLM decision engine may determine findings, scores, contracts, or evidence maturity.
- Evidence is append-only.

## Public Interfaces

- Public JSON outputs are versioned.
- Contract JSON/YAML outputs must be exact native output, not RTK summaries.
- Audit output must not include credentials or sensitive infrastructure details.
- `ai:state`, `ai:context`, and `ai:impact` are stdout-only by design; their output is Git-SHA-tied and must not be redirected into tracked files without deliberate review.
