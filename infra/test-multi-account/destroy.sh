#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
echo "WARNING: destroying all Stronghold multi-account test infrastructure."
echo "This deletes resources in both configured AWS accounts."
read -r -p "Continue? (y/N) " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

terraform destroy -auto-approve
echo "All test resources destroyed."
