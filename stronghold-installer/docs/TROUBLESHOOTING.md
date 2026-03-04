# Depannage

## Les services ne demarrent pas

- verifie Docker: `systemctl status docker`
- verifie la stack: `cd /opt/stronghold && ./status.sh`
- consulte les logs: `./logs.sh` ou `./logs.sh api`

## Le package offline ne demarre pas

- verifie la presence de `images.tar` dans le package ou dans `/opt/stronghold`
- verifie que `docker load -i images.tar` fonctionne manuellement
- si seuls les services Stronghold sont precharges, le serveur doit encore pouvoir recuperer `postgres`, `redis`, `minio` et `nginx` si ces images ne sont pas deja locales

## Erreur de licence

- verifie la presence de `/opt/stronghold/stronghold.lic`
- verifie que `/etc/machine-id` existe sur l hote
- consulte `./status.sh` pour le statut de licence

## Impossible de se connecter

- verifie que le port HTTP/HTTPS choisi est libre
- controle `FRONTEND_URL`, `CORS_ORIGINS` et `CORS_ALLOWED_ORIGINS` dans `/opt/stronghold/.env`
- controle `./logs.sh nginx` et `./logs.sh api`

## Echec pendant upgrade

- consulte `./logs.sh api`
- consulte `./logs.sh postgres`
- si le rollback automatique ne suffit pas, restaure le backup cree avant la mise a jour avec `./restore.sh`

## Base corrompue ou erreur Prisma

- liste les backups disponibles: `./restore.sh`
- restaure l archive voulue
- redemarre ensuite la stack avec `docker compose -f docker-compose.prod.yml up -d`

## Disque plein

- verifie les logs Docker et le dossier `/opt/stronghold/backups`
- supprime ou exporte les anciennes sauvegardes
- surveille l usage MinIO via `./status.sh`

## TLS

- les certificats doivent etre au format PEM
- verifie les chemins `certs/fullchain.pem` et `certs/privkey.pem`
- teste la conf Nginx avant redemarrage: `docker compose -f docker-compose.prod.yml exec nginx nginx -t`
