# Stronghold Agent Instructions

Stronghold is an open-source disaster recovery intelligence platform for AWS. These instructions are canonical for Codex, Claude Code, Claude Opus, and any other repository-local agent.

## Operating Mode

1. Read the user brief fully before acting.
2. Identify the affected package or repository layer first.
3. Read only the files needed for the requested change.
4. Do not scan the whole repo unless the task is explicitly repository-wide.
5. Preserve product behavior unless the brief explicitly asks to change it.
6. Do not expand Phase 5 scope while adding memory, docs, tests, or tooling.

## Repository Shape

- `packages/core`: framework-free domain logic plus read-only cloud provider adapters.
- `packages/cli`: CLI entry point. Depends on core.
- `packages/server`: Express, Prisma, PostgreSQL. Private.
- `packages/web`: React, Vite, Tailwind. Private.
- Build order: core, cli, server, web, github-action.

## Scope Guardrails

Do not modify AWS scanners, product contracts semantics, orchestration, auth, identity, server, web, landing pages, or marketing docs unless the brief names them.

Do not refactor unrelated code while completing an AI memory, validation, or documentation task.

## Architectural Invariants

1. Core has no framework dependencies.
2. Pure-domain modules are network-free: contracts, evidence evaluation, scenario evaluation, validation, and related business-logic modules.
3. Provider, auth, and orchestration modules are explicit effect boundaries excluded from the pure-domain network guard.
4. AWS scans are strictly read-only.
5. RTO/RPO are null or UNKNOWN unless backed by measured tested evidence.
6. Estimated, suggested, or fallback RTO/RPO cannot satisfy contracts.
7. Missing measured tested evidence means UNKNOWN.
8. Stronghold is service-centric, not resource-centric.
9. Verdicts are deterministic: same inputs, same output.
10. Hooks and integrations remain outside pure domain modules.
11. No LLM or non-deterministic model is a decision engine.
12. Public JSON outputs are versioned.
13. Audit trail is always on.
14. Evidence is append-only.
15. Runbooks generate commands; they never execute them.
16. ARN is the canonical resource identifier.

## TypeScript Rules

- Strict TypeScript remains mandatory.
- No `any`.
- No unexplained `@ts-ignore` or `@ts-expect-error`.
- Files use kebab-case.
- Types use PascalCase.
- Functions use camelCase.
- Constants use SCREAMING_SNAKE_CASE.

## Dependencies

- Do not add dependencies unless the brief explicitly approves them.
- Use AWS SDK v3 only for AWS access.
- Testing uses Vitest only.

## RTK Policy

- If `rtk` is available, use it explicitly for noisy exploration commands.
- Do not use RTK for evidence, proof loops, CI truth, release truth, audit exports, or exact JSON/YAML contract output.
- Never assume RTK is installed.
- Never run global RTK initialization commands such as `rtk init`.

## Verification

After changes, run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

For AI memory/tooling changes, also run the relevant `ai:*` scripts.

## Code Hygiene

- No production `console.log`.
- Comments explain why, not what.
- Do not log credentials or infrastructure details in audit logs.
- Do not execute runbook commands.
- Do not auto-detect AWS profiles without explicit user request.
- Do not create Prisma tables for evidence, history, findings, or governance.
- Do not silently include newly glob-matched resources; flag them.

## More Context

- Product architecture: `docs/architecture.md`
- Code conventions: follow the TypeScript Rules and package-local lint/typecheck configuration above.
- AI memory: `docs/ai/`
