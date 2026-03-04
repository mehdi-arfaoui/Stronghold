# Prerequisites systeme

## Minimum

- OS: Linux (Ubuntu 22.04+, Debian 12+, RHEL 8+, Rocky Linux 9+)
- Architecture: x86_64 ou aarch64
- CPU: 2 vCPU
- RAM: 4 GB
- Disk: 20 GB SSD
- Docker Engine 24+ avec Docker Compose v2

## Recommande

- CPU: 4 vCPU
- RAM: 8 GB
- Disk: 50 GB SSD
- HTTPS avec certificat TLS

## Ports

- 80/TCP pour HTTP, configurable via `HTTP_PORT`
- 443/TCP pour HTTPS, configurable via `HTTPS_PORT`

## Reseau

- Acces a `ghcr.io` non requis si le package contient `images.tar`
- Premier demarrage: acces a Docker Hub recommande pour `postgres`, `redis`, `minio` et `nginx` si ces images ne sont pas deja presentes localement
- En fonctionnement normal, aucune connexion sortante Stronghold vers `ghcr.io` n est necessaire

## Fichiers

- Un fichier de licence `stronghold.lic`
- Optionnel: certificats TLS `fullchain.pem` et `privkey.pem` dans `certs/`
