# Claude Code Instructions

Import and follow `AGENTS.md` first. This file only adds Claude Code-specific review behavior.

## Review-Only Mode

- Default to review-only when asked to inspect a pull request, diff, or proposed change.
- Lead with bugs, regressions, missing tests, and invariant violations.
- Cite exact files and lines when possible.
- Keep summaries brief and secondary to findings.
- Do not rewrite code during review unless the user explicitly asks for implementation.
- Do not use Claude Code review output as proof that contracts, evidence, JSON, or release checks are valid; run native commands for truth.
