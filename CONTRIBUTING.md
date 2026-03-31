# Contributing to Stronghold

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/mehdi-arfaoui/stronghold.git
cd stronghold
npm install
npm run build
npm run test
```

### Run the CLI in dev mode

```bash
npx tsx packages/cli/src/index.ts demo
```

### Run the web UI in dev mode

```bash
# Start PostgreSQL
cd packages/server && docker compose -f docker-compose.dev.yml up -d

# Start the API server
npm run dev --workspace=packages/server

# In another terminal, start the frontend
npm run dev --workspace=packages/web
```

## Project Structure

- `packages/core` - Pure business logic (graph engine, scanners, DR validation, DRP generator)
- `packages/cli` - Command-line interface
- `packages/server` - Express API server
- `packages/web` - React web frontend

## Code Guidelines

- TypeScript strict mode - zero `any`
- All code must pass `npm run typecheck`, `npm run lint`, and `npm run test`
- DR validation rules must have a `category` from `DRCategory` and a justification
- RTO estimates must be honest: AWS documentation source URL, or `null` for unverified
- No telemetry, no analytics, no external network calls except AWS API during scan

## Adding a New AWS Scanner

See `packages/core/src/providers/aws/services/` for examples. Each scanner:

1. Uses an AWS SDK v3 client
2. Creates typed nodes with DR-relevant metadata
3. Creates edges for dependencies
4. Is registered in `aws-scanner.ts`
5. Has corresponding validation rules in `validation-rules.ts`

## Adding a New DR Validation Rule

See `packages/core/src/validation/validation-rules.ts`. Each rule:

1. Has a unique `id`
2. Has a `category` from `DRCategory`
3. Has a `severity` (critical / high / medium / low)
4. Is a pure function reading node metadata
5. Answers: "does this affect the ability to restore or failover in a disaster?"
6. Must NOT be a security or maintenance rule - only DR
7. Has pass + fail tests in the test suite

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes with tests
4. Verify: `npm run test && npm run typecheck && npm run lint`
5. Open a pull request with a clear description
