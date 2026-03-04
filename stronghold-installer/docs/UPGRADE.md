# Mise a jour

## Methode recommandee

1. Recupere le nouveau package client
2. Decompresse le package
3. Lance:

```bash
sudo bash upgrade.sh <version>
```

Le script peut etre lance depuis le nouveau package extrait. Il recopie les
fichiers dans `/opt/stronghold`, cree un backup automatique, charge `images.tar`
si present, puis met a jour la stack.

## Ce que fait `upgrade.sh`

1. backup automatique avant changement
2. mise a jour de `STRONGHOLD_VERSION`
3. `docker load -i images.tar` si `images.tar` est present
4. sinon `docker compose pull`
5. redemarrage de la stack
6. execution de `npx prisma migrate deploy`
7. verification des healthchecks
8. rollback automatique sur les images precedentes si le redemarrage echoue

## Verification apres upgrade

```bash
cd /opt/stronghold
./status.sh
./logs.sh api
```

## Limite importante

Le rollback automatique replace les images precedentes mais ne revert pas
les migrations Prisma deja appliquees. Le backup automatique reste la reference
pour une restauration complete en cas d incident majeur.
