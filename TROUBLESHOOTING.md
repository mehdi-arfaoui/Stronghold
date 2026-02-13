# Guide de dÃƒÂ©pannage - Stronghold

## ProblÃƒÂ¨me : "NetworkError when attempting to fetch resource"

### Causes possibles

1. **Backend non dÃƒÂ©marrÃƒÂ©**
   - VÃƒÂ©rifiez que le backend est accessible : `http://localhost:4000/health/live`
   - Si vous utilisez Docker : `docker-compose ps` pour voir les conteneurs

2. **Variables d'environnement non chargÃƒÂ©es**
   - Les variables `VITE_*` doivent ÃƒÂªtre disponibles au dÃƒÂ©marrage du serveur Vite
   - VÃƒÂ©rifiez dans la console du navigateur (F12) les logs `[API Config]`

3. **ProblÃƒÂ¨me de CORS**
   - Le backend doit autoriser les requÃƒÂªtes depuis `http://localhost:3000`
   - VÃƒÂ©rifiez les logs du backend pour les erreurs CORS

4. **Port incorrect**
   - Backend doit ÃƒÂªtre sur le port 4000
   - Frontend doit ÃƒÂªtre sur le port 3000

### Solutions

#### Avec Docker Compose

```bash
# ArrÃƒÂªter tous les conteneurs
docker-compose down

# RedÃƒÂ©marrer avec reconstruction
docker-compose up --build

# VÃƒÂ©rifier les logs
docker-compose logs backend
docker-compose logs frontend
```

#### Sans Docker (dÃƒÂ©veloppement local)

1. **Backend** :
   ```bash
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate dev
   node prisma/seed.cjs
   npm run dev
   ```
   Le backend doit ÃƒÂªtre accessible sur `http://localhost:4000`

2. **Frontend** :
   ```bash
   cd frontend
   npm install
   # CrÃƒÂ©er un fichier .env.local avec :
   # VITE_API_URL=/api
   # VITE_ENV=development
   npm run dev
   ```
   Le frontend doit ÃƒÂªtre accessible sur `http://localhost:3000`

### Test de connexion

Utilisez le script PowerShell `test-connection.ps1` :

```powershell
.\test-connection.ps1
```

Ou testez manuellement :

```powershell
# Test backend
Invoke-WebRequest -Uri "http://localhost:4000/health/live"

# Test API avec clÃƒÂ©
$headers = @{ "x-api-key" = "\$SEED_API_KEY" }
Invoke-WebRequest -Uri "http://localhost:4000/services" -Headers $headers
```

### Configuration de l'API dans le frontend

Si les variables d'environnement ne sont pas chargÃƒÂ©es, vous pouvez configurer l'API directement dans l'interface :
1. Ouvrez l'application dans le navigateur
2. Utilisez la banniÃƒÂ¨re de configuration en haut de la page
3. Entrez :
   - Backend URL: `http://localhost:4000`
   - API Key: `\$SEED_API_KEY`
4. Cliquez sur "Sauvegarder"

La configuration est sauvegardÃƒÂ©e dans le localStorage du navigateur.

## OCR indisponible (tesseract manquant)

### Causes possibles

- Tesseract n'est pas installÃƒÂ© sur le serveur.
- Le binaire `tesseract` n'est pas dans le `PATH` du service.

### Solutions

```bash
# Installer via APT
sudo apt-get update
sudo apt-get install -y tesseract-ocr libtesseract-dev

# Ou utiliser le script du dÃƒÂ©pÃƒÂ´t
sudo backend/scripts/install-ocr.sh

# VÃƒÂ©rifier l'installation
tesseract --version
```

Si vous utilisez Docker, ajoutez le paquet dans l'image ou montez un binaire disponible sur l'hÃƒÂ´te.

## ProblÃƒÂ¨me : `Failed to resolve import "tslib" from "node_modules/.vite/deps/echarts-for-react.js"`

### Causes possibles

- DÃƒÂ©pendances frontend non installÃƒÂ©es ou cache Vite obsolÃƒÂ¨te.
- Installation partielle (node_modules manquant).

### Solutions

```bash
cd frontend
npm install
npm run dev
```

Si l'erreur persiste, supprimez `.vite` et relancez Vite :

```bash
rm -rf frontend/node_modules/.vite
cd frontend
npm run dev
```

Si vous voyez une erreur TypeScript liÃƒÂ©e ÃƒÂ  `src/vendor/tslib.ts`, supprimez tout ancien fichier `frontend/src/vendor/tslib.ts` (issu d'un shim local obsolÃƒÂ¨te), puis relancez un build propre :

```bash
rm -f frontend/src/vendor/tslib.ts
docker compose build --no-cache frontend
```

## Entretien Docker (espace disque)

Pensez ÃƒÂ  nettoyer rÃƒÂ©guliÃƒÂ¨rement les ressources Docker inutilisÃƒÂ©es pour ÃƒÂ©viter que le fichier `docker_data.vhdx` n'enfle (notamment sous Docker Desktop). Vous pouvez :

- Lancer le script local `./cleanup.sh` (basÃƒÂ© sur `docker system prune` et `docker volume prune`).
- Utiliser `docker compose prune` si vous gÃƒÂ©rez plusieurs projets Compose.
- Utiliser la fonction **Clean / Purge data** dans Docker Desktop pour libÃƒÂ©rer l'espace disque.

## Performance Docker Desktop (ressources)

Si les builds sont lents ou que les conteneurs dÃƒÂ©marrent difficilement, augmentez les ressources allouÃƒÂ©es ÃƒÂ  Docker Desktop (par exemple **12 Go de RAM** et **6 CPU**). Des ressources plus ÃƒÂ©levÃƒÂ©es, combinÃƒÂ©es ÃƒÂ  des images lÃƒÂ©gÃƒÂ¨res (Alpine) et des builds multi-stage, rÃƒÂ©duisent les temps de build et de dÃƒÂ©marrage.
