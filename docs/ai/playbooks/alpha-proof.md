# Alpha Proof Playbook

Version: 1

The local alpha proof loop is:

1. Run the local demo.
2. Validate contracts before evidence and expect UNKNOWN.
3. Add measured tested evidence.
4. Validate contracts after evidence and expect MET.

Use:

```bash
npm run ai:proof-loop
```

The proof loop must be native. Do not use RTK as the authoritative output for the proof-loop result.

`ai:state`, `ai:context`, and `ai:impact` are stdout-only by design; their output is Git-SHA-tied and should not be redirected into tracked files without deliberate review.
