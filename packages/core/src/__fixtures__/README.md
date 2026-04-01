# Stronghold Fixture Capture

Real AWS fixtures are captured with `scripts/capture-fixtures.ts`. The script runs the normal AWS scan pipeline, writes one sanitized file per scanner under `packages/core/src/__fixtures__/aws-real/`, and also writes an `aggregate.json` file with pipeline output plus per-region scanner metadata.

Use it with the same AWS auth flow as `stronghold scan`, for example:

```bash
npx tsx scripts/capture-fixtures.ts --region eu-west-1
npx tsx scripts/capture-fixtures.ts --profile production --region eu-west-1,us-east-1 --verbose
```

Redaction is mandatory. The capture flow sanitizes payloads before they are written and marks every emitted fixture with a `_meta` header that records:

- `capturedAt`
- `strongholdVersion`
- `redacted`
- `region` or `regions`

Leak validation is also mandatory. After redaction, Stronghold scans the captured payloads for likely sensitive leftovers, including:

- raw AWS ARNs
- raw AWS account IDs
- raw IP addresses
- raw email addresses
- obvious internal hostnames
- obvious bucket names that were not masked
- obvious KMS key identifiers that were not masked

If any of those patterns are still present, capture fails and the fixture set is not written as commit-safe output.

Manual review is still required before commit. Even when the automated leak checks pass, inspect the sanitized files and confirm they do not expose account-specific names, operational details, or anything you would not want in source control.
