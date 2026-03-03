# Demo Build Separation

## Decision

Stronghold now ships two build targets from the same codebase:

- `client`: no demo code is compiled or packaged
- `internal`: demo onboarding, demo seeds, and demo routes remain available

This separation is enforced at build time, not by hiding UI at runtime.

## Backend

- Pure demo sources live under `backend/src/demo/`
- Demo route mounting in `backend/src/index.ts` is conditional and uses `createRequire(...)` with a guarded `require('./demo/demoRoutes.js')`
- Client local builds use `backend/tsconfig.client.json` through `backend/scripts/build.mjs` to exclude `src/demo/**/*` from `dist`
- Docker client builds also remove `src/demo` before compilation
- Docker internal images keep `src/demo` available in the final image

## Frontend

- Demo UI lives under `frontend/src/pages/demo/`
- `vite.config.ts` defines `__DEMO_ENABLED__` from `BUILD_TARGET`
- `OnboardingPage.tsx` loads demo UI lazily through `import.meta.glob(...)`, so the client build still compiles when `src/pages/demo` is physically absent
- Docker client builds remove `src/pages/demo` before compilation

## Why this design

- The client build must not contain dormant demo code, routes, or fixtures
- The internal build must keep commercial demo flows intact
- Build-time separation is simpler to audit than runtime feature flags
- Physical removal in Docker gives an additional control beyond tree-shaking

## Validation performed

- Client and internal builds pass for backend and frontend
- Production backend tests pass when demo sources and demo tests are temporarily removed
- Client bundles were grepped to confirm the expected demo symbols are absent
- Backend Docker `client` and `internal` images both build successfully
- `src/demo` is absent from `stronghold-api:client` and present in `stronghold-api:internal`
