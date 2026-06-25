# Stronghold RTK Policy

RTK is optional repository-local assistance for noisy exploration. Stronghold does not install RTK, initialize RTK globally, or depend on RTK in CI.

## Use RTK Explicitly When Available

When `rtk` is already installed and available on `PATH`, agents may use it explicitly for exploration commands:

- `rtk git status`
- `rtk git diff`
- `rtk git log`
- `rtk grep`
- `rtk find`
- `rtk vitest`
- `rtk tsc`
- `rtk lint`

Native commands remain valid. RTK absence must never block development, CI, tests, or proof loops.

## Do Not Use RTK As Authoritative Output

Do not use RTK as the source of truth for:

- `stronghold contracts validate --format json`
- `stronghold evidence add`
- `npm run ai:proof-loop`
- `npm run ai:verify-invariants`
- release checks
- audit exports
- exact JSON/YAML contract outputs

If RTK reports a failure, inspect the full raw output and rerun the native command when exact details are required.

## Safety Boundaries

- Do not run `rtk init` as part of Stronghold repository setup.
- Do not modify global Claude Code, Codex, Cursor, shell, PATH, or machine configuration.
- Do not add RTK binaries, generated telemetry, raw tee logs, or machine-local configuration to Git.
