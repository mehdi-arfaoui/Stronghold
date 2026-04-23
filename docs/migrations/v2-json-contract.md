# Migration v1 to v2: Unified JSON Contract

Stronghold 2.0.0 unifies the `scan --format json` output into a single canonical format.

## What changed

### Before (v1.x, single-account)

```json
{
  "scan": { "...": "..." },
  "nodes": [],
  "edges": []
}
```

### Before (v1.x, multi-account)

```json
{
  "scan": {
    "accounts": [],
    "errors": []
  },
  "graph": {
    "nodes": [],
    "edges": []
  }
}
```

### After (v2.0, unified)

```json
{
  "scan": {
    "version": "2.0.0",
    "scannedAt": "2026-04-21T14:23:10Z",
    "accounts": [],
    "errors": [],
    "summary": {}
  },
  "graph": {
    "nodes": [],
    "edges": [],
    "crossAccount": {
      "edges": [],
      "summary": {}
    }
  },
  "findings": [],
  "services": []
}
```

## Migration examples

### jq queries

```bash
# v1.x single-account
jq '.nodes' scan.json

# v2.0, all cases
jq '.graph.nodes' scan.json
```

### Python parsing

```python
# v1.x single-account
nodes = data["nodes"]

# v2.0, all cases
nodes = data["graph"]["nodes"]
```

## Why this change

The v1.x dual-format output was confusing: a script written for single-account scans could break when users moved to multi-account scans. v2.0 makes the richer multi-account structure the only structure.

Single-account users see no behavioral change in the scan itself. Only the JSON output is more structured.

## Rollback

There is no compatibility flag in v2.0. If you need the v1.x format temporarily, pin your dependencies to `@stronghold-dr/cli@^1.0.0`. That version will not receive the v2 JSON contract updates.
