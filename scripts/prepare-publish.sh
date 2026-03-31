#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Stronghold npm publish preparation ==="

echo "Building packages..."
npm run build --workspace=packages/core
npm run build --workspace=packages/cli

echo "Running tests..."
npm run test --workspace=packages/core
npm run test --workspace=packages/cli

echo "Updating CLI dependency for publish..."
cd packages/cli
node -e "const fs = require('node:fs'); const pkg = require('./package.json'); pkg.dependencies['@stronghold-dr/core'] = pkg.version; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');"
cd ../..

echo "Verifying package contents..."
cd packages/core
npm pack --dry-run
cd ../..
cd packages/cli
npm pack --dry-run
cd ../..

echo ""
echo "=== Ready to publish ==="
echo ""
echo "  cd packages/core && npm publish --access public"
echo "  cd ../cli && npm publish --access public"
echo ""
echo "After publish, revert CLI dependency:"
echo "  git checkout packages/cli/package.json"
