# Claude Opus Brief Template

Read `AGENTS.md`, then use this brief.

## Task

Implement or review:

## Non-Negotiables

- Do not change product behavior unless requested.
- Do not change AWS scanners unless requested.
- Do not change contract semantics unless requested.
- Do not expand Phase 5 scope.
- Do not use RTK as authoritative output.

## Relevant Invariants

- Estimated/fallback RTO/RPO cannot satisfy contracts.
- Missing measured tested evidence means UNKNOWN.
- Pure-domain modules are network-free.
- Provider, auth, and orchestration modules are explicit effect boundaries excluded from the pure-domain network guard.
- AWS scans are read-only.
- Verdicts are deterministic.
- Public JSON outputs are versioned.

## Expected Verification

- `npm run ai:context`
- `npm run ai:impact`
- `npm run ai:verify-invariants`
- `npm run ai:proof-loop`
