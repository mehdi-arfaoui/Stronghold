#!/usr/bin/env bash
set -euo pipefail

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

CACHE_DIR="${BUILDX_CACHE_DIR:-/tmp/.buildx-cache}"
BUILDER_NAME="stronghold-builder"

# Create the builder with local cache if it doesn't exist
if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  echo "Creating docker buildx builder: $BUILDER_NAME"
  docker buildx create \
    --name "$BUILDER_NAME" \
    --driver docker-container \
    --driver-opt network=host \
    --use >/dev/null
else
  docker buildx use "$BUILDER_NAME" >/dev/null
fi

# Build with local persistent cache using docker-bake.hcl if available
if [[ -f "docker-bake.hcl" ]]; then
  echo "Building with docker-bake.hcl..."
  docker buildx bake \
    --set "*.cache-from=type=local,src=${CACHE_DIR}" \
    --set "*.cache-to=type=local,dest=${CACHE_DIR}-new,mode=max" \
    --progress=plain \
    "$@"

  # Rotate cache to avoid infinite growth
  rm -rf "${CACHE_DIR}"
  mv "${CACHE_DIR}-new" "${CACHE_DIR}" 2>/dev/null || true
else
  echo "Building with docker compose..."
  # Fallback to docker compose build
  docker compose build --progress=plain "$@"
fi

echo "Build completed successfully!"
