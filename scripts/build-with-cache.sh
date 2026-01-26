#!/usr/bin/env bash
set -euo pipefail

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

builder_name="stronghold-builder"
if ! docker buildx inspect "$builder_name" >/dev/null 2>&1; then
  docker buildx create --name "$builder_name" --use >/dev/null
else
  docker buildx use "$builder_name" >/dev/null
fi

docker compose build --no-cache --progress=plain "$@"
