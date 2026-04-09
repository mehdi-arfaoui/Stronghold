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

## Adding Service Detection Logic

Service detection logic lives in `packages/core/src/services/`.

Each detection source should:

1. Expose an explicit confidence level
2. Return service candidates compatible with the existing service model
3. Be registered in the service detection pipeline
4. Avoid false positives for infrastructure-only resources such as VPC, subnet, IAM, and security-group-only groupings

Keep precedence deterministic: manual definitions must remain the strongest source, and lower-confidence sources must not reassign resources already claimed by a stronger one.

## Adding Evidence Types

Evidence logic lives in `packages/core/src/evidence/`.

To add a new evidence type:

1. Update the `EVIDENCE_TYPES` list and the `EvidenceType` type
2. Define its confidence weight
3. Define its expiration behavior if it is time-bound
4. Add extraction logic if it can be derived automatically
5. Add tests for extraction, freshness, and scoring impact

Evidence changes affect reporting and scoring, so keep the confidence values and lifecycle behavior synchronized with the docs.

## Adding Scenario Types

Scenario logic lives in `packages/core/src/scenarios/`.

Each scenario type should:

1. Have a stable type identifier
2. Define which resources are directly affected
3. Rely on reverse BFS over application edges for impact propagation
4. Produce a coverage verdict that considers evidence and runbook liveness
5. Use the term "scenario coverage analysis" in docs and messages

Do not let infrastructure-only edges drive service impact propagation.

## Working with Governance

Governance logic lives in `packages/core/src/governance/`.

Key constraints:

1. All `governance.yml` sections are optional
2. Scan and report flows should surface invalid governance as warnings rather than block execution
3. CLI risk acceptance requires a non-empty justification and a 30-365 day expiration
4. Findings with policy violations cannot be risk-accepted through the CLI flow
5. Governance changes and state transitions must emit audit events

Keep the YAML schema, CLI helpers, and audit behavior aligned.

## Working with History

History logic lives in `packages/core/src/history/`.

Key constraints:

1. Snapshots are compact posture metrics, never full scan payloads
2. Finding lifecycle keys must stay in `ruleId::nodeId` format
3. DR debt formula changes require matching updates to `docs/scoring.md` and `docs/history.md`
4. Trend logic must stay conservative on short histories and use recent stored posture rather than raw scan diffs

## Security

See [docs/security.md](docs/security.md) for the current storage model, threat model, and deployment guidance.

Vulnerability reporting:

- email `security@stronghold.software`
- no public bug bounty at this stage

Contributor reminders:

- never log infrastructure payloads in the audit trail
- never log AWS credentials, encryption passphrases, or secrets
- keep external network calls limited to the AWS APIs needed for scanning

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes with tests
4. Verify: `npm run test && npm run typecheck && npm run lint`
5. Open a pull request with a clear description
