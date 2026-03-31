#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run build --workspace=packages/core
npm run build --workspace=packages/cli

cd packages/cli
npm link
cd ../..

echo "CLI linked. Recording demo..."
echo ""
echo "Use one of:"
echo ""
echo "  Option 1 - asciinema + agg:"
echo "    asciinema rec docs/assets/demo.cast --cols 100 --rows 30"
echo "    # Run the commands below"
echo "    agg docs/assets/demo.cast docs/assets/demo.gif --theme monokai"
echo ""
echo "  Option 2 - VHS:"
echo "    vhs scripts/demo.tape"
echo ""
echo "Commands to run in the recording:"
echo "  stronghold demo --scenario startup"
echo "  stronghold report"
echo "  stronghold plan generate"
