# @stronghold-dr/core

Core engine for [Stronghold](https://github.com/mehdi-arfaoui/Stronghold) -- open-source disaster recovery intelligence for AWS.

This package contains the pure business logic: infrastructure discovery, dependency graph analysis,
DR validation, service detection, evidence model, scenario coverage analysis, DRP generation,
posture history, and governance.

`@stronghold-dr/core` has zero framework dependencies. It can be used from the CLI, a server,
tests, or custom integrations.

It is designed for TypeScript projects that want Stronghold's recovery analysis engine without
taking a dependency on the CLI package.

## Installation

```bash
npm install @stronghold-dr/core
```

## What's inside

- **AWS Discovery** -- Read-only scanners for 16 AWS services, normalized into a dependency graph
- **Service Model** -- Automatic service detection from CloudFormation, tags, topology, and manual definitions
- **DR Validation** -- 39 rules across 6 categories (backup, redundancy, failover, detection, recovery, replication)
- **Evidence Model** -- Five maturity levels (observed, inferred, declared, tested, expired) with confidence-weighted scoring
- **Scenario Coverage** -- AZ failure, region failure, SPOF failure, data corruption analysis with coverage verdicts
- **DRP Generation** -- Declarative recovery plans and executable runbooks in YAML
- **Posture Memory** -- Scan history, finding lifecycle, DR debt tracking, and trend analysis
- **Governance** -- Ownership tracking, risk acceptance, and custom policy enforcement
- **Graph Analysis** -- SPOF detection, blast radius, criticality scoring, circular dependency detection

## Usage

```typescript
import { awsScanner, runValidation, detectServices, analyzeBuiltInScenarios, generateDRPlan } from '@stronghold-dr/core';
```

For CLI usage, see [@stronghold-dr/cli](https://www.npmjs.com/package/@stronghold-dr/cli).

For full documentation, see the [Stronghold repository](https://github.com/mehdi-arfaoui/Stronghold).

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0)
