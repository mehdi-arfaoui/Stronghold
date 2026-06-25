# Change Contract Template

## Intent

Describe the smallest user-visible or repository-visible outcome.

## Scope

Files or packages expected to change:

- 

Explicitly out of scope:

- Product behavior not named in the brief
- AWS scanners unless named
- Server and web unless named

## Invariants Checked

- Measured tested evidence is required for RTO/RPO contract proof.
- Missing measured tested evidence remains UNKNOWN.
- Core stays deterministic and side-effect free.
- Public JSON outputs remain versioned.

## Verification

- `npm run ai:verify-invariants`
- `npm run ai:proof-loop`
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
