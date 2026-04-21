# Synthetic Multi-Account Fixtures

These fixtures model two fictional AWS accounts entirely offline:

- `111111111111` (`stronghold-test-prod`)
- `222222222222` (`stronghold-test-staging`)

They are intentionally written in TypeScript so tests can reuse shared ARN
builders, account contexts, and exact metadata shapes expected by the real
cross-account detectors.

The fixtures replace AWS discovery only. The synthetic tests still exercise the
real Stronghold merge and cross-account detection code paths.
