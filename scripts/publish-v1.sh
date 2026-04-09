#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Stronghold v1.0.0 Publish Script ==="
echo ""

echo "1. Checking npm authentication..."
npm whoami || { echo "ERROR: Not logged in to npm. Run 'npm login' first."; exit 1; }

echo "2. Checking git status..."
if [[ -n $(git status --porcelain) ]]; then
  echo "WARNING: Working directory has uncommitted changes."
  echo "Commit or stash before publishing."
  exit 1
fi

echo "3. Checking current branch..."
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "WARNING: Not on main branch (on $BRANCH). Switch to main before publishing."
  exit 1
fi

echo "4. Running full build..."
npm run build

echo "5. Running tests..."
npm run test

echo "6. Running typecheck..."
npm run typecheck

echo "7. Running lint..."
npm run lint

echo ""
echo "=== Pre-flight checks passed ==="
echo ""

CORE_VERSION=$(node -e "console.log(require('./packages/core/package.json').version)")
CLI_VERSION=$(node -e "console.log(require('./packages/cli/package.json').version)")
echo "Core version: $CORE_VERSION"
echo "CLI version: $CLI_VERSION"

if [[ "$CORE_VERSION" != "1.0.0" ]] || [[ "$CLI_VERSION" != "1.0.0" ]]; then
  echo "ERROR: Versions are not 1.0.0. Fix package.json files first."
  exit 1
fi

echo ""
echo "=== Publishing @stronghold-dr/core ==="
(
  cd packages/core
  npm publish --access public
)

echo ""
echo "=== Waiting 10 seconds for npm registry propagation ==="
sleep 10

echo ""
echo "=== Publishing @stronghold-dr/cli ==="
(
  cd packages/cli
  npm publish --access public
)

echo ""
echo "=== Verifying published packages ==="
echo "Core:"
npm view @stronghold-dr/core version
echo "CLI:"
npm view @stronghold-dr/cli version

echo ""
echo "=== Testing npx installation ==="
echo "Run manually: npx @stronghold-dr/cli@1.0.0 demo"

echo ""
echo "=== Done ==="
