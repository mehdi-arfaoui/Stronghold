# Stronghold

Open-source recoverability-as-code framework.
Turn DR promises into measured, enforceable proof.

Your AWS console says you are protected. Your DR plan promises recovery within one hour.
But has anyone tested it? How long did it take? Can you prove it to an auditor?

## See it in action

```bash
# 1. Run the demo (no AWS needed)
npx @stronghold-dr/cli demo

# 2. Check recovery contracts
npx @stronghold-dr/cli contracts validate
# -> UNKNOWN: No tested evidence with measured RTO for service 'startup-api'

# 3. Add evidence from a real recovery test
npx @stronghold-dr/cli evidence add \
  --service startup-api \
  --scenario region_failure \
  --type tested \
  --rto 45m \
  --rpo 2m

# 4. Validate again
npx @stronghold-dr/cli contracts validate
# -> MET: Tested RTO 45m <= required 1h
```

Stronghold defined RTO <= 1h and RPO <= 5m, found no proof, then verified measured evidence.
The verdict changed from UNKNOWN to MET. That closes the proof loop.

## What Stronghold does

- **Verifies recovery contracts** - declare RTO, RPO, and evidence requirements per service, then check them against reality.
- **Returns enforceable verdicts** - every requirement is MET, VIOLATED, or UNKNOWN through deterministic, evidence-based evaluation.
- **Measures the Reality Gap** - see the distance between configured backups and proven recovery.
- **Maps service dependencies** - build an AWS dependency graph and trace complete recovery chains.
- **Integrates in CI/CD** - `stronghold contracts validate --ci` exits nonzero for enforced contract violations.

## How it works

```text
Define contracts          Scan infrastructure        Get verdicts
+-----------------+      +-----------------+      +-----------------+
| contracts.yml   |      | stronghold scan |      | MET             |
|                 |      |                 |      | VIOLATED        |
| service: pay    | ---> | AWS evidence    | ---> | UNKNOWN         |
| rto: 1h         |      | recovery chains |      |                 |
| evidence: tested|      | SPOF detection  |      | Prove it or     |
|                 |      |                 |      | fix it.         |
+-----------------+      +-----------------+      +-----------------+
```

Stronghold treats recovery like a testable contract.
You declare what recovered means for each service.
Stronghold reads AWS state, evaluates recovery chains and tested evidence, then returns a verdict.
It identifies contracts that are proven, violated, or still unproven.

UNKNOWN is not a bug.
It identifies the exact recovery claim that still lacks proof.

## Recovery Contracts

Recovery contracts live beside application and infrastructure code.
They describe required recovery behavior for a business service under a disruption scenario.

```yaml
# .stronghold/contracts.yml
version: "1"
contracts:
  - service: payment-processing
    enforcement: enforce
    requirements:
      - scenario: region-failure
        rto: 1h
        rpo: 5m
        evidence: tested
        chain_coverage: proven
        spof: none
```

Each requirement combines one scenario with one or more proof dimensions.
Missing proof produces UNKNOWN, never an assumed success.

| Dimension | What it checks |
|-----------|----------------|
| `rto` | Recovery time objective, verified against tested evidence and never estimated |
| `rpo` | Recovery point objective, verified against tested evidence and never estimated |
| `evidence` | Minimum evidence level: `tested` > `declared` > `observed` > `inferred` |
| `chain_coverage` | Full recovery path proof: `proven` > `observed` > `partial` |
| `spof` | Single point of failure tolerance: `none`, `mitigated`, or `any` |

RTO and RPO are never estimated.
Without a measured recovery test, Stronghold returns UNKNOWN and names the missing evidence.

`enforcement: warn` reports verdicts without changing the exit code.
`enforcement: enforce` returns exit code `1` when a requirement is VIOLATED.

## Quick Start

Stronghold requires Node.js 20 or later and read-only AWS access.

```bash
# Install
npm install -g @stronghold-dr/cli

# Initialize (configure AWS profile and region)
stronghold init

# Scan your infrastructure
stronghold scan

# See your services and their recovery status
stronghold services list
stronghold status

# Create your first recovery contract
stronghold contracts init
# Edit .stronghold/contracts.yml with your requirements

# Validate contracts
stronghold contracts validate

# Add evidence from a recovery test
stronghold evidence add \
  --service <your-service> \
  --scenario region_failure \
  --type tested \
  --rto <measured-time> \
  --rpo <measured-time>

# Validate again - watch UNKNOWN become MET
stronghold contracts validate
```

Stronghold stores local artifacts under `.stronghold/`.
Recovery contracts belong in `.stronghold/contracts.yml`.
Measured evidence remains append-only.

The AWS discovery path is read-only.
Stronghold never changes resources or executes generated recovery commands.

## CI/CD

```bash
# In your pipeline
stronghold scan
stronghold contracts validate --ci

# Exit code 0: no enforced contract is violated
# Exit code 1: at least one enforced contract is violated
```

Add `.stronghold/contracts.yml` to the repository.
Each pipeline run verifies declared recovery requirements against current proof.

The `--ci` flag uses stable `[PASS]`, `[FAIL]`, and `[UNKNOWN]` labels.
UNKNOWN remains visible without being converted into a false failure or success.

## Commands

Commands follow three workflows: define proof, inspect AWS state, and prepare recovery actions.

### Recovery contracts

| Command | Description |
|---------|-------------|
| `stronghold contracts init` | Create a starter `.stronghold/contracts.yml` |
| `stronghold contracts validate` | Check contracts against the latest scan and local evidence |
| `stronghold evidence add` | Register measured recovery test evidence |
| `stronghold evidence list` | List evidence records |

Use `stronghold contracts validate --format json` for machine-readable verdicts.
Use `stronghold contracts validate --ci` for stable pipeline labels.

### Infrastructure analysis

| Command | Description |
|---------|-------------|
| `stronghold scan` | Read AWS infrastructure and produce a local snapshot |
| `stronghold status` | Show the current DR posture snapshot |
| `stronghold services list` | List detected business services |
| `stronghold graph` | Export the dependency graph as HTML |
| `stronghold demo` | Run with sample AWS data and no AWS account |

The demo writes a local scan and starter recovery contract.
It does not call AWS.

### DR planning

| Command | Description |
|---------|-------------|
| `stronghold report` | Produce a full DR report by service |
| `stronghold scenarios` | Analyze disruption scenario coverage |
| `stronghold plan generate` | Generate DRP-as-Code |
| `stronghold plan runbook` | Generate recovery runbooks |

Generated plans and runbooks are outputs only.
Stronghold never executes their commands.

### Typical local workflow

```bash
stronghold scan
stronghold services list
stronghold contracts validate
stronghold evidence list
stronghold status
```

### Typical proof update

```bash
stronghold evidence add \
  --service payment-processing \
  --scenario region_failure \
  --type tested \
  --rto 45m \
  --rpo 2m

stronghold contracts validate
```

Run `stronghold --help` for global options.
Run `stronghold <command> --help` for command-specific flags.

## Architecture

```text
Monorepo - TypeScript strict - Zero LLM

packages/core    Pure business logic, zero framework dependencies
packages/cli     CLI entry point
packages/server  Express API (optional)
packages/web     React dashboard (optional)
```

- **Deterministic** - identical inputs always produce identical verdicts.
- **Read-only** - Stronghold never modifies AWS infrastructure.
- **Evidence-first** - no recovery conclusion exists without attached proof.
- **Service-centric** - evaluation targets business services, not isolated resources.
- **No LLM** - the decision engine contains no AI or probabilistic reasoning.

The core package has no framework dependencies.
ARNs remain the canonical identifiers for AWS resources.
Audit logging is always enabled.

See [docs/ARCHITECTURE.md](docs/architecture.md) for details.

## Contributing and License

Contributions are welcome.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

### Fresh worktree bootstrap

```bash
npm ci
npm run build
npm run ai:verify-invariants
npm run ai:proof-loop
```

### Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run artifacts:check
```

Changes must preserve strict TypeScript, deterministic verdicts, and read-only AWS access.
Tests use Vitest and must not call real AWS services.

### Generated runtime artifacts

Stronghold uses policy B for tracked runtime artifacts. `github-action/dist/index.js` is generated by `npm run build --workspace=github-action` and committed because GitHub Action consumers execute the `action.yml` `dist/index.js` entrypoint directly. Refresh it deliberately with:

```bash
npm run artifacts:refresh
npm run artifacts:check
```

`packages/cli/bin/stronghold.js` is a tracked npm CLI bin wrapper required by package consumers. It is not generated by the TypeScript build, but it is covered by the artifact check because npm can touch bin shebang line endings on Windows.

AGPL-3.0 - see [LICENSE](LICENSE).

## Project Status

[![Build](https://github.com/mehdi-arfaoui/stronghold/actions/workflows/ci.yml/badge.svg)](https://github.com/mehdi-arfaoui/stronghold/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40stronghold-dr%2Fcli.svg)](https://www.npmjs.com/package/@stronghold-dr/cli)
[![Tests](https://img.shields.io/github/actions/workflow/status/mehdi-arfaoui/stronghold/ci.yml?branch=main&label=tests)](https://github.com/mehdi-arfaoui/stronghold/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
