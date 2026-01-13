#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ce script doit être exécuté avec sudo/root."
  exit 1
fi

apt-get update
apt-get install -y tesseract-ocr libtesseract-dev
echo "Tesseract installé. Vérifiez avec: tesseract --version"
