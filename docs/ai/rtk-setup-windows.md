# RTK Setup On Windows

RTK is optional for Stronghold. The repository does not install RTK, run `rtk init`, or change global shell, PATH, Claude Code, Codex, or Cursor configuration.

## Native Windows Install

Install RTK using the upstream RTK instructions for Windows. Keep the install outside this repository.

After installation, open a new PowerShell session and verify:

```powershell
rtk --version
```

If PowerShell cannot find `rtk`, add the RTK install directory to your user PATH through Windows settings, then open a new shell.

## PATH Verification

```powershell
where.exe rtk
rtk --version
```

The command should resolve to the RTK executable you installed.

## Gain Verification

```powershell
rtk gain
```

This checks the local RTK status. Stronghold treats the result as advisory only.

## Native Windows Usage

On native Windows, RTK is not injected into commands automatically. Use explicit commands such as:

```powershell
rtk git status
rtk grep contracts
rtk vitest
```

Use native commands for exact contract JSON/YAML, evidence, proof loops, CI, release checks, and audit exports.

## Why No `rtk init`

Global `rtk init` is intentionally not part of Stronghold setup. Repository contributors should not need machine-global RTK configuration to build, test, validate, or prove Stronghold.

## Optional Future WSL Note

WSL may offer a different RTK integration path later. Stronghold does not require migration to WSL, and CI must continue to use native commands.
