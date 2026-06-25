# Architecture Map

Version: 1

## Workspace

- `packages/core`: framework-free core containing pure deterministic domain modules plus read-only cloud provider adapters.
- `packages/cli`: command-line workflows, local files, hooks, audit sessions.
- `packages/server`: private API and persistence surface.
- `packages/web`: private UI surface.
- `github-action`: CI integration package.

## AI-Relevant Areas

- Contracts: `packages/core/src/contracts/`, `packages/cli/src/commands/contracts.ts`
- Evidence: `packages/core/src/evidence/`, `packages/cli/src/commands/evidence.ts`
- Pure domain side-effect guard: all source files under `packages/core/src/` except `providers/`, `auth/`, `orchestration/`, tests, fixtures, and generated output.
- Proof loop: `packages/cli/src/commands/demo.ts`, `packages/cli/src/__tests__/proof-loop-e2e.test.ts`
- AI memory: `AGENTS.md`, `CLAUDE.md`, `RTK.md`, `docs/ai/`
- AI scripts: `scripts/ai/`

## Boundaries

- Contract evaluation belongs in core.
- Pure-domain modules are network-free and must not import or call network clients.
- Provider, auth, and orchestration modules are explicit effect boundaries excluded from the pure-domain network guard.
- CLI may orchestrate files, rendering, audit sessions, and hooks.
- Server and web are not part of this AI operating-system layer.
- AWS scanners are not part of this task unless a future brief names them.

## Script Output

- `ai:state`, `ai:context`, and `ai:impact` write stdout only by design; their output is tied to the current Git SHA and should not be redirected into tracked files without deliberate review.
