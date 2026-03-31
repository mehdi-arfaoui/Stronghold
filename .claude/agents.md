# .claude/agents.md — Stronghold Codex Guide

## Mission

Stronghold is an open-source disaster recovery automation platform for cloud infrastructure. It discovers infrastructure, builds dependency graphs, generates executable recovery plans as code, and validates them with non-destructive micro-tests.

Your role is to implement and refactor code safely inside this repository while preserving the architectural boundaries described below.

## Product context

Stronghold supports AWS first and is being structured to support Azure. The platform is built around these capabilities:

- infrastructure discovery
- dependency graph construction
- resilience analysis
- drift detection
- DRP-as-Code generation
- recovery validation through micro-tests

## Repository architecture

This is a monorepo with four packages:

```text
packages/
├── core/          # Pure business logic
├── cli/           # CLI entry point
├── server/        # NestJS API server
└── web/           # React frontend
Architectural rule: core owns the domain

packages/core/ contains the business logic and domain model.

It must:

have zero dependency on NestJS, Express, or server runtime concerns
be importable by both cli and server
remain deterministic where possible
contain provider adapters, graph logic, DRP generation, validation, and drift detection

Business logic must not live in server/ or cli/.

Provider model

Cloud providers implement a common provider contract. Keep provider logic isolated and aligned with the existing abstractions.

Illustrative contract:

interface CloudProvider {
  name: string;
  scan(credentials: ProviderCredentials): Promise<InfrastructureGraph>;
  validate(plan: DRPlan, tests: ValidationTest[]): Promise<ValidationResult[]>;
  checkDrift(previous: InfrastructureGraph, current: InfrastructureGraph): DriftReport;
}

When working on providers:

preserve provider-specific logic inside provider modules
keep cross-provider logic in core
do not leak AWS-specific assumptions into generic domain types unless explicitly intended
Current codebase context

The codebase originated as a monolithic NestJS application and is being extracted into the monorepo structure above.

Important existing logic to preserve and adapt:

AWS scanners
graphology-based dependency graph builder
SPOF detection
resilience scoring
recommendation engine
React graph visualization in web

When migrating existing code:

extract pure logic first
remove framework coupling
preserve behavior unless the task explicitly changes it
prefer incremental refactors over speculative rewrites
Delivery priorities

Unless a task explicitly says otherwise, prefer work in this order:

core extraction and purity
CLI scan and plan generation flows
DR validation engine
drift detection
Azure adapter skeleton
web cleanup
tests, CI, docs
public launch readiness
Non-negotiable coding standards
TypeScript
Assume strict TypeScript at all times
Do not use any
Prefer unknown, type guards, generics, or discriminated unions
All exported functions must have explicit return types
Use readonly for immutable properties
Prefer interface for object shapes
Use discriminated unions for result and state modeling

Example:

type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };
Error handling

Do not throw generic untyped errors.

Do not use throw new Error(...) for domain failures
Prefer typed domain error classes
Prefer result-style returns for expected failures
Preserve original causes when wrapping failures

Example:

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
Naming
Files: kebab-case.ts
Classes: PascalCase
Functions and methods: camelCase
Constants: UPPER_SNAKE_CASE
Interfaces: PascalCase, never prefixed with I
Type parameters must be descriptive
Function design
Prefer functions under 30 lines
Prefer at most 3 parameters; otherwise use an options object
In core, prefer pure functions with no side effects
Handle unhappy paths early
Extract helpers instead of nesting complex logic
File design
Prefer files under 200 lines
One class per file
index.ts files must only re-export
Group by feature, not by technical layer
Comments and documentation
Do not add comments that restate code
Add comments only when explaining why a decision exists
Add JSDoc for exported functions and public interfaces
Do not leave commented-out code
Testing
Use Vitest
Keep test files next to source files
Name tests by behavior
Use fixtures where helpful
Mock cloud SDK calls
Never call real AWS or Azure services in tests unless the task explicitly requires it
Dependencies
Keep dependencies minimal
Prefer built-in Node.js modules when sufficient
Prefer modular cloud SDK clients
Do not add utility libraries for simple operations
If adding a dependency, keep the implementation justified and narrow
Commits

Use conventional commits:

feat(...)
fix(...)
refactor(...)
test(...)
docs(...)
chore(...)

Rules:

one logical change per commit
no generated files
no credentials
no .env
no node_modules
Absolute anti-patterns

Never do any of the following:

use any
add business logic to server/ or cli/
place logic in barrel files
use default exports
leave commented-out code
add console.log debugging in committed code
hardcode credentials, secrets, or regions
use synchronous file operations without strong reason
use nested ternaries deeper than two levels
introduce magic numbers without named constants
throw untyped generic errors
create speculative abstractions not required by the task
DRP-as-Code domain guidance

The DRP format is YAML-first and represents an executable recovery plan.

Core concepts include:

version
generation timestamp
infrastructure hash
critical services
service components
recovery strategies
recovery steps
validation tests
drift detection metadata

When implementing DRP features:

prefer deterministic outputs
base recovery strategy on actual resource attributes, not assumptions
keep serialization and validation separate from generation logic
preserve a clear boundary between domain types and transport or presentation shapes
How to work in this repo

For each task:

Read the relevant files before editing
Reuse existing patterns from nearby modules
Keep changes minimal but coherent
Preserve architectural boundaries
Run or reason through type safety before finishing
Add or update tests when requested
Export new public APIs through the appropriate index.ts files
Summarize changed files, constraints, and remaining risks
Task execution preferences

When implementing a feature:

start from the smallest complete vertical slice
prefer pure domain extraction over framework integration
preserve compatibility with existing types where reasonable
favor explicitness over cleverness
do not silently change public behavior unless required

When refactoring old NestJS code into core:

separate pure logic from transport and persistence concerns
remove Prisma, Redis, Express, NestJS, and HTTP concerns from extracted domain modules
keep domain code reusable by CLI and server

When adding Azure support:

begin with compile-safe skeletons
do not invent unsupported runtime behavior
use clear stubs when functionality is not implemented yet
Quality gate before finishing

Before considering a task complete, verify as many of these as possible:

code respects package boundaries
exported APIs have explicit types
no any
no framework leakage into core
no logic inside index.ts
tests added or updated when requested
imports remain tidy and local
public exports are wired correctly
changes are consistent with existing naming and structure
If task instructions conflict

Use this precedence order:

direct user task instructions
this `.claude/agents.md`
local code patterns, if they do not violate the two rules above

If a user task mentions another planning document such as `.claude/instructions.md`, treat that file as product and architecture context. Use `.claude/agents.md` as the execution contract.

Preferred output behavior for coding tasks

When you finish a coding task, summarize:

files created or modified
what was implemented
what remains intentionally out of scope
any risks, assumptions, or follow-up items
