# Installation

## 1. Verifier les prerequis

Consulte `REQUIREMENTS.md` pour la taille machine et les prerequis Docker.

## 2. Obtenir le package

Decompresse le tarball fourni:

```bash
tar xzf stronghold-installer-<version>.tar.gz
cd stronghold-installer-<version>
```

Le package peut inclure `images.tar`. Si ce fichier est present, `install.sh`
charge les images Stronghold localement et n a pas besoin de `ghcr.io`.

## 3. Ajouter la licence

Option 1:

- copie `stronghold.lic` a la racine du package avant l installation

Option 2:

- lance l installation sans licence
- active la licence depuis l interface web apres le premier demarrage

## 4. Lancer l installation

```bash
sudo bash install.sh
```

Le script:

- verifie la machine
- installe Docker si necessaire
- copie les fichiers dans `/opt/stronghold`
- genere les secrets de production
- charge `images.tar` si present, sinon fait `docker compose pull`
- demarre la stack et applique les migrations Prisma

## 5. Acceder a l interface

Le script affiche l URL finale. Par defaut:

```text
http://<ip-du-serveur>
```

## 6. Activer la licence

Si `stronghold.lic` n etait pas present a l installation:

- copie le fichier dans `/opt/stronghold/stronghold.lic`
- ou active la licence depuis l interface web

## 7. Creer le compte administrateur

Au premier acces, termine le setup via l interface web pour creer
le compte administrateur local.

## 8. TLS optionnel

Copie les certificats dans:

```text
/opt/stronghold/certs/fullchain.pem
/opt/stronghold/certs/privkey.pem
```

Puis adapte `nginx/nginx.conf` pour activer le bloc HTTPS et redemarre:

```bash
cd /opt/stronghold
docker compose -f docker-compose.prod.yml up -d nginx
```

## 9. Commandes utiles

```bash
cd /opt/stronghold
./status.sh
./logs.sh
./backup.sh
./upgrade.sh
```
