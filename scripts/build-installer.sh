#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-$(git describe --tags --always 2>/dev/null || echo 'dev')}"
IMAGE_TAG="${VERSION#v}"
OUTPUT_DIR="dist"
PACKAGE_NAME="stronghold-installer-${VERSION}"
PACKAGE_DIR="${OUTPUT_DIR}/${PACKAGE_NAME}"
API_IMAGE="ghcr.io/mehdux69/stronghold-api:${IMAGE_TAG}"
WEB_IMAGE="ghcr.io/mehdux69/stronghold-web:${IMAGE_TAG}"

if [[ ! -d "stronghold-installer" ]]; then
  echo "Missing stronghold-installer directory" >&2
  exit 1
fi

if [[ ! -f "stronghold-installer/frontend-nginx.conf" ]]; then
  echo "Missing stronghold-installer/frontend-nginx.conf" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build the installer package" >&2
  exit 1
fi

echo "Building installer package: ${PACKAGE_NAME}"
echo "Using Stronghold image tag: ${IMAGE_TAG}"

mkdir -p "${OUTPUT_DIR}"
rm -rf "${PACKAGE_DIR}"
rm -f "${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz"
mkdir -p "${PACKAGE_DIR}"

cp -a stronghold-installer/. "${PACKAGE_DIR}/"
if [[ ! -f "${PACKAGE_DIR}/frontend-nginx.conf" ]]; then
  echo "frontend-nginx.conf was not copied into the installer package" >&2
  exit 1
fi
printf '%s\n' "${IMAGE_TAG}" > "${PACKAGE_DIR}/VERSION"
chmod +x "${PACKAGE_DIR}"/*.sh

echo "Pulling application images from ghcr.io..."
docker pull "${API_IMAGE}"
docker pull "${WEB_IMAGE}"

echo "Exporting offline images archive..."
docker save -o "${PACKAGE_DIR}/images.tar" "${API_IMAGE}" "${WEB_IMAGE}"

tar czf "${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz" -C "${OUTPUT_DIR}" "${PACKAGE_NAME}"

echo ""
echo "Package created: ${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz"
echo "Archive size: $(du -h "${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz" | awk '{print $1}')"
