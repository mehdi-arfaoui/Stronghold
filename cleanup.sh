#!/usr/bin/env bash
set -euo pipefail

cat <<'MSG'
Ce script supprime les ressources Docker inutilisées.
- docker system prune : images, conteneurs, réseaux, build cache
- docker volume prune : volumes orphelins

Assurez-vous que rien d'important n'est en cours d'utilisation.
MSG

printf "\nLancer le nettoyage maintenant ? (y/N) "
read -r confirm

if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Nettoyage annulé."
  exit 0
fi

docker system prune --all --force
DockerSystemExit=$?

if [[ $DockerSystemExit -ne 0 ]]; then
  echo "Erreur lors de docker system prune." >&2
  exit $DockerSystemExit
fi

docker volume prune --force

echo "Nettoyage terminé."
