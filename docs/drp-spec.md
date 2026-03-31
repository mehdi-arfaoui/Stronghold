# DRP-as-Code Specification

## Overview

A Stronghold DR Plan is a declarative document that answers four questions:

- What logical services exist in this infrastructure?
- Which components belong to each service?
- How should each component be recovered?
- In what order should recovery happen?

The document is declarative, not executable. It records recovery intent, ordering, and evidence. Operators or future runbook tooling still perform the actual failover or restore actions.

## YAML Shape

The CLI emits YAML with a short comment header, followed by the serialized plan:

```yaml
# Stronghold DR Plan
# Generated: 2026-03-27T18:31:54.676Z
# Infrastructure hash: a1b2c3d4e5f6
# Regions: eu-west-1, us-east-1
# Resources: 24
# DR Posture Score: 52/100 (Grade: C)

id: drp-a1b2c3d4e5f6
version: "1.0"
generated: "2026-03-27T18:31:54.676Z"
infrastructureHash: a1b2c3d4e5f6
provider: aws
regions:
  - eu-west-1
  - us-east-1
services:
  - name: database
    criticality: critical
    rtoTarget: 15m
    rpoTarget: 5m
    estimatedRTO: 2m
    estimatedRPO: 0s
    recoveryOrder:
      - prod-db-primary
    validationTests:
      - name: prod-db-primary connectivity
        type: connectivity
        target: prod-db-primary
        description: Verify dependency connectivity for prod-db-primary.
        timeout: 1m
    components:
      - resourceId: prod-db-primary
        resourceType: DATABASE
        name: Production Database
        region: eu-west-1
        recoveryStrategy: restore_from_backup
        estimatedRTO: 2h
        estimatedRPO: 24h
        dependencies: []
        risks:
          - backup: No backup detected for prod-db-primary
        recoverySteps:
          - action: restore_snapshot
            target: prod-db-primary
            description: Restore prod-db-primary from the latest valid backup or snapshot.
            timeout: 30m
        rtoEstimate:
          rtoMinMinutes: null
          rtoMaxMinutes: null
          rpoMinMinutes: null
          rpoMaxMinutes: null
          confidence: unverified
          method: Snapshot restore - no reliable time estimate without testing.
          factors:
            - name: restore_method
              value: snapshot
              impact: AWS uses lazy loading during restore.
              source:
                type: aws_documentation
                url: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RestoreFromSnapshot.html
          limitations:
            - Only a tested restore can establish reliable RTO
        effectiveRTO:
          componentRTOMin: null
          componentRTOMax: null
          chainRTOMin: null
          chainRTOMax: null
          bottleneck: null
          chainContainsUnverified: true
          assumption: sequential_restore
        warnings:
          - Chain RTO requires testing because at least one component in the dependency chain is unverified.
metadata:
  totalResources: 24
  coveredResources: 18
  uncoveredResources:
    - subnet-private-a
  worstCaseRTO: 2h
  averageRPO: 797m
  stale: false
```

## Top-Level Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable plan identifier derived from the infrastructure hash |
| `version` | string | DRP schema version, currently `1.0` |
| `generated` | ISO 8601 string | Plan generation timestamp |
| `infrastructureHash` | string | Hash of the graph state the plan was generated from |
| `provider` | string | Cloud provider, currently `aws` for the shipped CLI flow |
| `regions` | string[] | Regions covered by the scan |
| `services` | `DRPService[]` | Logical services in recovery order groups |
| `metadata` | object | Coverage and freshness summary |

## Service Fields

Each entry in `services[]` represents a logical service group rather than a single AWS resource.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | Logical service name such as `database`, `storage`, or an app/service label |
| `criticality` | `critical \| high \| medium \| low` | Service criticality derived from graph analysis |
| `rtoTarget` | string | Human target like `15m`, `1h`, or `24h` |
| `rpoTarget` | string | Human target like `5m`, `1h`, or `24h` |
| `components` | `DRPComponent[]` | Recoverable components belonging to the service |
| `validationTests` | `ValidationTest[]` | Post-recovery checks |
| `estimatedRTO` | string | Service-level headline RTO |
| `estimatedRPO` | string | Service-level headline RPO |
| `recoveryOrder` | string[] | Component IDs in the order Stronghold expects recovery to happen |

## Component Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `resourceId` | string | Resource identifier, often ARN-like |
| `resourceType` | string | Normalized node type such as `DATABASE`, `OBJECT_STORAGE`, or `DNS` |
| `name` | string | Human-readable component name |
| `region` | string | Region or `global` |
| `recoveryStrategy` | string | Strategy inferred from observed metadata |
| `recoverySteps` | `RecoveryAction[]` | Ordered recovery actions |
| `estimatedRTO` | string | Human-readable summary |
| `estimatedRPO` | string | Human-readable summary |
| `dependencies` | string[] | Components that must be available first |
| `risks` | string[] | Reasons Stronghold considers recovery risky or incomplete |
| `rtoEstimate` | `RTOEstimate` | Structured estimate with factors and limitations |
| `effectiveRTO` | `EffectiveRTO` | Chain-aware estimate after dependency propagation |
| `warnings` | string[] | Extra caveats, usually for unverified chains |

## Recovery Strategies

Current component strategies include:

- `aurora_failover`
- `aurora_global_failover`
- `failover`
- `restore_from_backup`
- `rebuild`
- `dns_failover`
- `auto_scaling`
- `manual`
- `none`

These are descriptive outputs, not shell commands. They are meant to anchor runbooks, review, and drift validation.

## Honest RTO and RPO

The `rtoEstimate` block is where Stronghold explains how it reached an estimate.

| Field | Type | Meaning |
| --- | --- | --- |
| `rtoMinMinutes` | number or `null` | Best-case bound |
| `rtoMaxMinutes` | number or `null` | Worst-case bound |
| `rpoMinMinutes` | number or `null` | Best-case data-loss bound |
| `rpoMaxMinutes` | number or `null` | Worst-case data-loss bound |
| `confidence` | `documented \| informed \| unverified` | Confidence level |
| `method` | string | Human explanation of the estimate |
| `factors` | `RTOFactor[]` | Evidence used to derive the estimate |
| `limitations` | string[] | What the estimate does not capture |

`null` means Stronghold refuses to invent a trustworthy number from the available evidence.

## Effective RTO

`effectiveRTO` answers a different question from `rtoEstimate`.

- `rtoEstimate` is about the component itself.
- `effectiveRTO` includes dependency ordering and bottlenecks in the chain.

Important fields:

- `chainRTOMax`
- `bottleneck`
- `chainContainsUnverified`

If any dependency in the recovery chain is unverified, Stronghold carries that uncertainty forward.

## Metadata

The `metadata` block summarizes plan completeness:

| Field | Meaning |
| --- | --- |
| `totalResources` | Total nodes in the analyzed graph |
| `coveredResources` | Resources included in service/component coverage |
| `uncoveredResources` | Nodes intentionally or currently left outside the service mapping |
| `worstCaseRTO` | Headline worst-case RTO across the plan |
| `averageRPO` | Headline average RPO across covered services |
| `lastValidated` | Optional validation timestamp |
| `stale` | Whether the plan is known stale |
| `staleReason` | Optional explanation for staleness |

## Validate a Plan

Use the latest scan snapshot to validate an existing DRP:

```bash
npx @stronghold-dr/cli plan validate --plan drp.yaml
```

Validation checks:

- infrastructure hash drift
- missing components
- recovery-strategy mismatches

## Programmatic Usage

The core package is usable directly from TypeScript. For example, if you already have a graphology-compatible graph in memory:

```ts
import { DirectedGraph } from 'graphology';
import {
  analyzeFullGraph,
  generateDRPlan,
  serializeDrPlanToYaml,
  validateDRPlan,
  type InfraNodeAttrs,
} from '@stronghold-dr/core';

const graph = new DirectedGraph();

graph.addNode('prod-db-primary', {
  id: 'prod-db-primary',
  name: 'Production Database',
  type: 'DATABASE',
  provider: 'aws',
  region: 'eu-west-1',
  availabilityZone: null,
  tags: {},
  metadata: {
    sourceType: 'RDS',
    dbIdentifier: 'prod-db-primary',
    multiAz: true,
    backupRetentionPeriod: 7,
  },
} satisfies InfraNodeAttrs);

const analysis = await analyzeFullGraph(graph);
const plan = generateDRPlan({
  graph,
  analysis,
  provider: 'aws',
  generatedAt: new Date(),
});

const yaml = serializeDrPlanToYaml(plan);
const report = validateDRPlan(plan, graph);
```

That makes it possible to embed DRP generation or validation in your own tooling without going through the CLI or the server package.

## Versioning

Commit `drp.yaml` to Git and review diffs after infrastructure changes:

```bash
npx @stronghold-dr/cli plan generate > drp.yaml
git diff drp.yaml
```

Pair that with [drift detection](./getting-started.md#6-track-drift-over-time) to catch changes between scans.
