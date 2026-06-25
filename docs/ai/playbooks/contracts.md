# Contracts Playbook

Version: 1

## Rules

- Contracts are satisfied only by deterministic inputs.
- RTO/RPO requirements require measured tested evidence.
- Estimated, suggested, validated, fallback, or graph-simulated RTO/RPO does not prove a contract.
- Missing measured tested evidence returns UNKNOWN, not MET.
- Contract evaluators are pure-domain modules and must not import or call network clients.
- Provider, auth, and orchestration modules are explicit effect boundaries excluded from the pure-domain network guard.
- Exact JSON/YAML contract output must come from native Stronghold commands.

## Checkpoints

- Search contract evaluators before changing validation behavior.
- Keep hooks and integrations outside pure domain modules.
- Run `npm run ai:verify-invariants`.
- `npm run ai:verify-invariants` also runs targeted contract tests for expired evidence and UNKNOWN-versus-VIOLATED behavior.
- Run `npm run ai:proof-loop`.
- Use `stronghold contracts validate --format json` natively when exact JSON matters.
