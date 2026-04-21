# Stronghold — Conventions

## Code style

- Files: `kebab-case.ts` (e.g., `encryption-service.ts`)
- Types/Interfaces: `PascalCase` (e.g., `EncryptedPayload`)
- Functions: `camelCase` (e.g., `encryptScanData`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_CONCURRENCY`)
- Types go in dedicated `*-types.ts` files, not inline
- Export from `index.ts` barrel files per module
- No `console.log` in production code — use structured logger or audit logger
- Comments explain WHY, not WHAT — never paraphrase the code
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`

## Testing

- Framework: **vitest** — never jest
- Test files: `*.test.ts` next to source, or in `__tests__/`
- No real AWS calls in unit tests — mock SDK clients
- Integration tests run on demo fixtures (`packages/core/src/__fixtures__/`)
- AWS-real fixtures in `__fixtures__/aws-real/` are optional — tests skip cleanly if absent
- E2E tests in `__e2e__/` are skipped by default, activated via `STRONGHOLD_E2E=true`
- Demo fixtures are always present and committed
- Coverage targets: ≥ 80% on new code, ≥ 90% on critical modules

## CLI conventions

- `NO_COLOR` disables colors
- `--verbose` enables detailed output
- Exit codes: 0 = success or partial success, 1 = business failure, 2 = config error
- `--encrypt` and `--passphrase` for encryption, `--redact` for redaction
- `--profile`, `--role-arn`, `--external-id`, `--account` for AWS auth
- `--concurrency` (1-16, default 5), `--scanner-timeout` (10-300s, default 60)
- `--overrides <path>` and `--no-overrides` for graph overrides
- `--ci` for CI-friendly output (no colors, no spinners, GitHub Actions annotations)
- `--fail-threshold <number>` for drift check CI exit code

### CLI commands

| Command | Purpose |
|---------|---------|
| `stronghold scan` | Scan, detect services, validate, score, recommend |
| `stronghold report` | Full DR report by service |
| `stronghold graph` | Export interactive HTML graph |
| `stronghold explain <service>` | Reality gap reasoning chain |
| `stronghold scenarios` | Scenario coverage analysis |
| `stronghold plan generate` | Generate DRP-as-Code YAML |
| `stronghold plan validate` | Validate DRP against current infra |
| `stronghold plan runbook` | Generate executable runbooks |
| `stronghold drift check` | Compare current vs baseline |
| `stronghold demo` | Run with sample data |
| `stronghold init` | Interactive setup wizard |
| `stronghold status` | DR posture snapshot |
| `stronghold history` | DR posture timeline |
| `stronghold evidence add/list/show` | Evidence management |
| `stronghold governance` | Governance overview |
| `stronghold governance init/accept/validate` | Governance management |
| `stronghold services detect/list/show` | Service management |
| `stronghold overrides init/validate` | Override management |
| `stronghold iam-policy` | Generate minimal IAM policy JSON |

## Server conventions

- Async scan: POST returns PENDING, client polls GET
- Orphan scans recovered to FAILED on startup
- Rate limiting: 10 scans/min, 100 req/min global
- Error responses: structured JSON with error code, details only in dev
- Logger: JSON structured, stack traces only in dev
- Env vars validated at startup via zod
- Service detection results persisted as JSON in ScanData (not a separate Prisma table)
- Evidence, history, finding lifecycles, governance stored as JSON, not separate Prisma tables
- Risk acceptance POST returns 501 intentionally (planned for future)

### Server API routes

| Route | Purpose |
|-------|---------|
| `POST/GET /api/scans` | Scan management |
| `GET /api/reports/:id` | Report retrieval |
| `GET /api/graph/:id` | Graph export |
| `GET /api/services/:scanId` | Service list |
| `GET /api/scenarios/:scanId` | Scenario coverage |
| `GET /api/governance` | Governance overview |
| `GET /api/evidence` | Evidence list |
| `GET /api/history` | Scan history |
| `GET /api/health` | Health check |

## Web conventions

- 3 states on every page: skeleton → error → data
- Polling backoff for async scan: 1s → 3s → 5s
- API client uses relative URLs (works behind nginx)
- Dark mode default, light mode supported
- Zustand for minimal global state, heavy data stays in hooks
- Types imported from `@stronghold-dr/core`, never redefined locally
- Code splitting: React.lazy for Graph, Charts, Services pages
- No shadcn/ui — pure Tailwind

## Dependencies policy

Approved dependencies (do not add others without explicit approval):

**Core:** graphology (MIT), yaml (ISC), AWS SDK v3 (`@aws-sdk/*`)
**CLI:** commander, chalk, ora
**Server:** express, @prisma/client, zod
**Web:** react, @xyflow/react, recharts, zustand, tailwindcss
**Test:** vitest

Prefer native Node.js APIs over external packages. No `p-limit`, no external crypto libs, no additional frameworks.