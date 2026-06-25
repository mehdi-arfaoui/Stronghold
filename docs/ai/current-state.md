# Current State

Version: 1

Active phase: Phase 5 alpha proof hardening. Keep this layer focused on repository memory, invariant checks, RTK policy, and local proof-loop validation.

Stronghold is an AWS disaster recovery intelligence platform organized as an npm workspace. Core is the deterministic business logic package; CLI orchestrates local workflows; server and web are private application surfaces.

Current AI operating goal:

- Keep agents aligned on contracts, evidence, proof loops, and scope boundaries.
- Preserve existing product behavior and contract semantics.
- Make local context compact enough for Codex, Claude Code, and Claude Opus to share.
- Keep RTK optional and never authoritative for evidence, CI, release, or exact JSON/YAML outputs.

Default verification:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run ai:verify-invariants`
- `npm run ai:proof-loop`
