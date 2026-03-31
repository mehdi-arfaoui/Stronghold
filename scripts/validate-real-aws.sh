#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "ERROR: validation failed on line ${LINENO}" >&2' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

print_step() {
  echo
  echo "$1"
}

echo "==================================================="
echo "Stronghold Real AWS Validation"
echo "==================================================="

print_step "0. Building and linking the local CLI..."
npm run build --workspace=packages/core
npm run build --workspace=packages/cli
npm link --workspace=packages/cli >/dev/null
CLI_BIN="$(command -v stronghold || true)"
if [[ -z "${CLI_BIN}" ]]; then
  echo "ERROR: stronghold binary not found after npm link." >&2
  exit 1
fi
echo "   Using CLI: ${CLI_BIN}"

mkdir -p .stronghold

print_step "1. Checking AWS credentials..."
aws sts get-caller-identity >/dev/null
echo "   Credentials OK"

REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-eu-west-1}}"
print_step "2. Using region: ${REGION}"

print_step "3. Running scan..."
stronghold scan --region "${REGION}" --output summary
echo "   Scan complete"

if [[ ! -f ".stronghold/latest-scan.json" ]]; then
  echo "ERROR: no scan results found at .stronghold/latest-scan.json" >&2
  exit 1
fi

print_step "4. Inspecting saved scan results..."
RESOURCE_COUNT="$(node -e "const s=require('./.stronghold/latest-scan.json'); console.log(s.nodes?.length ?? 0)")"
echo "   Resources discovered: ${RESOURCE_COUNT}"
if [[ "${RESOURCE_COUNT}" -eq 0 ]]; then
  echo "   WARN: no resources found. Check permissions and region."
fi

print_step "5. Generating terminal report..."
stronghold report --format terminal

print_step "6. Generating markdown report..."
stronghold report --format markdown > .stronghold/report.md
echo "   Saved to .stronghold/report.md"

print_step "7. Generating DR plan..."
stronghold plan generate --format yaml > .stronghold/drp.yaml
echo "   Saved to .stronghold/drp.yaml"

print_step "8. Generating runbook..."
stronghold plan runbook --format yaml > .stronghold/runbook.yaml
echo "   Saved to .stronghold/runbook.yaml"

print_step "9. Validating the DR plan against the current scan..."
stronghold plan validate --plan .stronghold/drp.yaml

print_step "10. Establishing drift baseline..."
stronghold drift check --save-baseline
echo "   Baseline saved"

print_step "11. Generating IAM policy..."
stronghold iam-policy > .stronghold/iam-policy.json
echo "   Saved to .stronghold/iam-policy.json"

print_step "12. Testing multi-region scan (${REGION}, us-east-1)..."
if ! stronghold scan --region "${REGION},us-east-1" --output summary; then
  echo "   WARN: multi-region scan failed. Additional permissions may be required in us-east-1."
fi

print_step "13. Testing service filter (rds, aurora, s3)..."
stronghold scan --region "${REGION}" --services rds,aurora,s3 --output summary

echo
echo "==================================================="
echo "Validation complete"
echo
echo "Review the generated files:"
echo "  .stronghold/latest-scan.json"
echo "  .stronghold/report.md"
echo "  .stronghold/drp.yaml"
echo "  .stronghold/runbook.yaml"
echo "  .stronghold/iam-policy.json"
echo
echo "Manually verify:"
echo "  - resource counts and service coverage"
echo "  - DR score realism and report findings"
echo "  - dependency mapping and recovery order"
echo "  - generated AWS CLI commands in the runbook"
echo "  - absence of crashes or unhandled errors"
echo "==================================================="
