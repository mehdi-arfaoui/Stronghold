# Real AWS Validation Checklist

Run `scripts/validate-real-aws.sh` or `scripts/validate-real-aws.ps1`, then review the results below.

## Scan Results

- [ ] Resource count matches the expected infrastructure size
- [ ] Expected service types are detected (RDS, EC2, S3, and others in scope)
- [ ] Regions are identified correctly
- [ ] The scan finishes without crashes or unhandled errors
- [ ] The scan time stays reasonable for the environment size

## DR Report

- [ ] The score looks realistic for a live environment
- [ ] Category scores match the actual posture of the account
- [ ] Findings reference real resources
- [ ] Blast-radius numbers look plausible
- [ ] Recommendations are actionable and technically correct

## DR Plan YAML

- [ ] Components match the discovered resources
- [ ] Recovery order respects real dependencies
- [ ] RTO and RPO values are plausible
- [ ] The infrastructure hash is populated

## Runbook

- [ ] AWS CLI commands reference real resource identifiers
- [ ] Commands are syntactically valid and copy-pasteable
- [ ] Verification commands remain read-only
- [ ] Approval-required steps are clearly marked
- [ ] Rollback procedures are present for each component

## Dependency Graph

- [ ] Dependencies between services are inferred correctly
- [ ] There are no obvious missing dependencies
- [ ] There are no obvious incorrect dependencies
- [ ] Single points of failure are surfaced where expected

## Edge Cases

- [ ] Resources without backups are flagged
- [ ] Mono-AZ resources are flagged
- [ ] Missing monitoring or alarms is detected
- [ ] Route53 health-check and failover coverage is validated
