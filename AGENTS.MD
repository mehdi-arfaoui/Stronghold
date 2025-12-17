# AGENTS — Stronghold

## Goal
Backend PRA/PCA multi-tenant (Node + TS + Prisma). Data isolation is mandatory.

## Non-negotiables
- Never introduce hard-coded secrets or sample real keys.
- Never log document contents or extracted sensitive facts in production logs.
- Every DB query MUST enforce tenantId (no cross-tenant reads/writes).
- Prefer deterministic outputs: JSON schemas, validations, tests.

## Commands
- Install: npm ci (or npm install)
- Prisma: npx prisma generate
- Migrations: npx prisma migrate dev
- Tests: npm test (or npm run test)
- Lint: npm run lint
- Dev: npm run dev

## Code layout
- src/routes: HTTP routes
- src/services: business logic
- src/ai: LLM prompts + parsing + schemas
- prisma/schema.prisma: models

## Definition of done
- Endpoint implemented + input validation
- Prisma migration included if schema changes
- Unit/integration tests where feasible
- No breaking changes without notes in README

Safety & Governance Rules

## Scope
This agent operates ONLY within the scope of code generation and analysis.
No operational or production actions are permitted.

## Allowed Actions
- Read-only access to public documentation
- Code generation (frontend, backend, infra templates)
- Static analysis and refactoring

## Forbidden Actions
- Accessing secrets or credentials
- Sending data externally
- Modifying production systems
- Executing destructive commands

## Internet Usage
Internet access is optional and restricted to documentation purposes only.
No data may be transmitted externally.

## Security & Compliance
The agent must comply with:
- Least privilege
- Data minimization
- Auditability
- Reproducibility
