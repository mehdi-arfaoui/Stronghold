# .claude/instructions.md — Stronghold Development Guide

## What is Stronghold

Stronghold is the first open-source disaster recovery automation platform for cloud infrastructure (AWS, Azure). It discovers infrastructure, builds dependency graphs, auto-generates executable recovery plans (DRP-as-Code), and validates them with non-destructive micro-tests.

## Architecture

Monorepo with 4 packages:

```
packages/
├── core/          # Pure business logic (scanner, graph, DRP engine, validators)
├── cli/           # CLI entry point (Commander.js)
├── server/        # NestJS API server (for cloud/self-hosted web version)
└── web/           # React frontend (Vite + Tailwind + shadcn + @xyflow/react)
```

### Core is the heart
`packages/core/` contains ALL business logic. It has ZERO dependency on NestJS, Express, or any server framework. It must be importable by both the CLI and the server.

### Provider pattern
Each cloud provider implements `CloudProvider` interface:
```typescript
interface CloudProvider {
  name: string;
  scan(credentials: ProviderCredentials): Promise<InfrastructureGraph>;
  validate(plan: DRPlan, tests: ValidationTest[]): Promise<ValidationResult[]>;
  checkDrift(previous: InfrastructureGraph, current: InfrastructureGraph): DriftReport;
}
```

## Code Standards — NON-NEGOTIABLE

### TypeScript
- `strict: true` in tsconfig, including `noUncheckedIndexedAccess: true`
- **ZERO `any`** — use `unknown` + type guards, generics, or discriminated unions
- All public functions must have explicit return types
- Use `readonly` on properties that should not be mutated
- Prefer `interface` over `type` for object shapes
- Use discriminated unions for state machines and result types:
  ```typescript
  type ValidationResult =
    | { status: 'pass'; details: PassDetails }
    | { status: 'fail'; error: FailureReason }
    | { status: 'degraded'; details: PassDetails; warnings: string[] };
  ```

### Error handling
- Never `throw new Error("something happened")`
- Define error classes per domain:
  ```typescript
  export class ScanError extends StrongholdError {
    constructor(
      public readonly provider: string,
      public readonly service: string,
      message: string,
      public readonly cause?: unknown,
    ) {
      super(`[${provider}/${service}] ${message}`);
    }
  }
  ```
- Use Result pattern for operations that can fail expectedly:
  ```typescript
  type Result<T, E = StrongholdError> =
    | { ok: true; value: T }
    | { ok: false; error: E };
  ```

### Naming
- Files: `kebab-case.ts` (e.g., `rds-scanner.ts`, `spof-detector.ts`)
- Classes: `PascalCase` (e.g., `InfrastructureAnalyzer`)
- Functions/methods: `camelCase` (e.g., `detectSinglePointsOfFailure`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_ATTEMPTS`)
- Interfaces: `PascalCase`, no `I` prefix (e.g., `CloudProvider`, not `ICloudProvider`)
- Type parameters: descriptive names (e.g., `TNode`, `TEdge`, not `T`, `U`)

### Functions
- Max 30 lines per function. If longer, extract helpers.
- Max 3 parameters. If more, use an options object.
- Pure functions in core/ — no side effects, no global state.
- Always handle the unhappy path first (early return pattern).

### Files
- Max 200 lines per file. If longer, split.
- One class per file.
- Index files (`index.ts`) only re-export, never contain logic.
- Group by feature, not by type (e.g., `providers/aws/rds/` not `scanners/rds/`)

### Comments
- NO comments that restate the code: `// Get the user` before `getUser()` is FORBIDDEN
- YES comments that explain WHY: `// AWS API returns max 100 results per page, we need to paginate`
- YES JSDoc on public interfaces and exported functions
- NO commented-out code — delete it, git has history

### Tests (Vitest)
- Test files next to source: `spof-detector.ts` → `spof-detector.test.ts`
- Describe blocks mirror the class/function structure
- Test names describe behavior: `it('should detect RDS without Multi-AZ as SPOF')`
- Use fixtures for AWS API responses (stored in `__fixtures__/`)
- Mock AWS SDK calls, never call real AWS in tests
- Coverage target: >70% on packages/core/

### Commits
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- One logical change per commit
- Message format: `feat(aws): add RDS backup validation`
- Never commit generated files, node_modules, .env, credentials

### Dependencies
- Minimize dependencies. Every new dependency must be justified.
- Prefer Node.js built-in modules over npm packages
- AWS SDK: use modular clients (`@aws-sdk/client-rds`, not `aws-sdk`)
- No utility libraries for simple operations (no lodash for basic array ops)

## Anti-patterns — NEVER DO THIS

- ❌ `any` type anywhere
- ❌ Functions longer than 30 lines
- ❌ Files longer than 200 lines
- ❌ Comments that restate code
- ❌ Commented-out code
- ❌ `console.log` for debugging (use structured logger)
- ❌ Hardcoded credentials or regions
- ❌ Business logic in server/ or cli/ (must be in core/)
- ❌ Synchronous file operations
- ❌ Default exports (use named exports)
- ❌ Barrel files with logic
- ❌ Nested ternaries deeper than 2 levels
- ❌ Magic numbers without named constants
- ❌ `throw` without a typed error class

## DRP-as-Code spec

The DRP is a YAML file with this structure:
- `version`: format version
- `generated`: ISO timestamp
- `infrastructure_hash`: hash of infra state at generation time
- `services[]`: list of critical services
  - Each service has: `name`, `criticality`, `rto_target`, `rpo_target`
  - Each service has `components[]` with cloud resources
  - Each component has `recovery_strategy` and `recovery_steps[]`
  - Each service has `validation[]` tests to verify recovery
- `drift_detection`: schedule and alert rules

## Current state of existing code

The codebase was previously a monolithic NestJS app. We are refactoring into the monorepo structure above. Key existing code to preserve and adapt:
- AWS scanners (EC2, RDS, S3, Route53, VPC, IAM, Lambda, ECS, ElastiCache, etc.)
- graphology-based dependency graph builder
- SPOF detection algorithm
- Resilience scoring engine
- Recommendation engine (19 rules)
- React frontend with @xyflow/react graph visualization

## What to prioritize

1. Core extraction (pure logic, no NestJS deps)
2. CLI with scan + plan generate commands
3. DR validation engine (5 basic micro-tests)
4. Drift detection
5. Azure adapter skeleton
6. Web dashboard cleanup
7. Tests + CI + docs
8. Public launch
