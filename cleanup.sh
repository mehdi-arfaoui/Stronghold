#!/bin/bash
# Purge les images et conteneurs non utilisés
docker compose down --remove-orphans
docker builder prune -af
docker system prune -af
docker volume prune -f
