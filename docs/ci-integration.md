# CI Integration

## Why CI drift monitoring

`stronghold drift check` works better in CI than as a local daemon:

- CI credentials are refreshed by the platform instead of expiring on a laptop.
- Scheduled workflows keep running even when nobody has a terminal open.
- Existing CI notifications, annotations, and artifacts become the delivery channel.
- A stored baseline in `.stronghold/` gives you repeatable comparisons without adding a background service.

## GitHub Actions setup

1. Generate the minimum read-only policy with `stronghold iam-policy`.
2. Create an IAM user or role that can assume that policy.
3. Add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as repository secrets, or switch the workflow to `role-to-assume`.
4. Copy [templates/github-actions/stronghold-drift.yml](/c:/Users/mehdi/Stronghold/templates/github-actions/stronghold-drift.yml) into `.github/workflows/stronghold-drift.yml`.
5. Set `AWS_REGION` as a repository variable if you do not want the default `eu-west-1`.
6. Run the workflow manually once. The first run creates and caches the baseline automatically.

## Configuration

Useful flags for CI runs:

- `--ci`: forces CI-friendly output, disables colored formatting, and emits GitHub Actions annotations to stderr.
- `--format json`: prints a machine-readable report with score deltas, finding diffs, and DRP impact analysis.
- `--fail-threshold <number>`: fails only when the score drops by at least that many points. The default is any decrease.
- `--redact`: redacts identifiers in terminal output, annotations, and JSON.

Example:

```bash
stronghold drift check --ci --format json --fail-threshold 5 --redact > drift-report.json
```

## Baseline management

Stronghold stores the latest scan and baseline under `.stronghold/`.

- First CI run: if no baseline exists, `stronghold drift check` saves the current scan as the baseline and exits `0`.
- Steady state: later runs compare the latest scan against that cached baseline.
- Intentional infrastructure change: rotate or delete the CI cache key after you approve the new posture, then rerun the workflow to establish a new baseline.
- Local troubleshooting: you can also refresh the baseline manually with `stronghold drift check --save-baseline`.

Because the template keeps a stable cache key, the baseline does not move unless you intentionally replace it.

## GitLab CI

Minimal example:

```yaml
drift_check:
  image: node:20
  script:
    - npm install -g @stronghold-dr/cli@^0.2.0
    - stronghold scan --region "$AWS_REGION" --redact
    - stronghold drift check --ci --format json --redact > drift-report.json
  artifacts:
    when: always
    paths:
      - drift-report.json
      - .stronghold/
```

Persist `.stronghold/` with your preferred cache or artifact policy so the baseline survives between scheduled runs.

## Jenkins

Minimal declarative stage:

```groovy
stage('Stronghold drift check') {
  steps {
    sh 'npm install -g @stronghold-dr/cli@^0.2.0'
    sh 'stronghold scan --region "$AWS_REGION" --redact'
    sh 'stronghold drift check --ci --format json --redact > drift-report.json'
    archiveArtifacts artifacts: 'drift-report.json,.stronghold/**', onlyIfSuccessful: false
  }
}
```

Use Jenkins credentials binding or an assumed role instead of writing AWS secrets to disk.

## Interpreting results

Exit codes:

- `0`: no drift, no score decrease, or first run baseline creation
- `1`: score decreased by at least the fail threshold or the DRP was degraded or invalidated

JSON fields:

- `hasDrift`: whether infrastructure changes were detected
- `scoreBefore`, `scoreAfter`, `scoreDelta`: DR posture delta between baseline and current scan
- `newFindings`, `resolvedFindings`: validation differences since the baseline
- `drpImpact`: prescriptive DRP impact analysis tied to plan sections
- `timestamp`: when the comparison ran

Annotations:

- Score regressions emit a `DR Score Decreased` warning.
- DRP-invalidating drift emits `DRP Invalidated` errors.
- Stronghold caps annotations at five per run to stay below GitHub's truncation limits.

## Troubleshooting

- `No file found at ...baseline...`: the baseline cache was not restored. Run the workflow once to create it, or check the cache key.
- Credential failures: confirm the CI identity can call `sts:GetCallerIdentity` and the read-only scan APIs.
- Permission gaps: Stronghold skips inaccessible scanners, but repeated `AccessDenied` responses usually mean the IAM policy is incomplete.
- Timeout issues: reduce scanned regions, narrow services, or raise the workflow timeout. The CLI still keeps per-scanner timeouts.
- Unexpected drift after a planned change: rotate the baseline cache after the change is accepted so the comparison target matches the new normal.
