# Guide de dépannage - Stronghold

## Problème : "NetworkError when attempting to fetch resource"

### Causes possibles

1. **Backend non démarré**
   - Vérifiez que le backend est accessible : `http://localhost:4000/health/live`
   - Si vous utilisez Docker : `docker-compose ps` pour voir les conteneurs

2. **Variables d'environnement non chargées**
   - Les variables `VITE_*` doivent être disponibles au démarrage du serveur Vite
   - Vérifiez dans la console du navigateur (F12) les logs `[API Config]`

3. **Problème de CORS**
   - Le backend doit autoriser les requêtes depuis `http://localhost:3000`
   - Vérifiez les logs du backend pour les erreurs CORS

4. **Port incorrect**
   - Backend doit être sur le port 4000
   - Frontend doit être sur le port 3000

### Solutions

#### Avec Docker Compose

```bash
# Arrêter tous les conteneurs
docker-compose down

# Redémarrer avec reconstruction
docker-compose up --build

# Vérifier les logs
docker-compose logs backend
docker-compose logs frontend
```

#### Sans Docker (développement local)

1. **Backend** :
   ```bash
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate dev
   node prisma/seed.cjs
   npm run dev
   ```
   Le backend doit être accessible sur `http://localhost:4000`

2. **Frontend** :
   ```bash
   cd frontend
   npm install
   # Créer un fichier .env.local avec :
   # VITE_BACKEND_URL=http://localhost:4000
   # VITE_API_KEY=dev-key
   npm run dev
   ```
   Le frontend doit être accessible sur `http://localhost:3000`

### Test de connexion

Utilisez le script PowerShell `test-connection.ps1` :

```powershell
.\test-connection.ps1
```

Ou testez manuellement :

```powershell
# Test backend
Invoke-WebRequest -Uri "http://localhost:4000/health/live"

# Test API avec clé
$headers = @{ "x-api-key" = "dev-key" }
Invoke-WebRequest -Uri "http://localhost:4000/services" -Headers $headers
```

### Configuration de l'API dans le frontend

Si les variables d'environnement ne sont pas chargées, vous pouvez configurer l'API directement dans l'interface :
1. Ouvrez l'application dans le navigateur
2. Utilisez la bannière de configuration en haut de la page
3. Entrez :
   - Backend URL: `http://localhost:4000`
   - API Key: `dev-key`
4. Cliquez sur "Sauvegarder"

La configuration est sauvegardée dans le localStorage du navigateur.

## OCR indisponible (tesseract manquant)

### Causes possibles

- Tesseract n'est pas installé sur le serveur.
- Le binaire `tesseract` n'est pas dans le `PATH` du service.

### Solutions

```bash
# Installer via APT
sudo apt-get update
sudo apt-get install -y tesseract-ocr libtesseract-dev

# Ou utiliser le script du dépôt
sudo backend/scripts/install-ocr.sh

# Vérifier l'installation
tesseract --version
```

Si vous utilisez Docker, ajoutez le paquet dans l'image ou montez un binaire disponible sur l'hôte.

## Problème : `Failed to resolve import "tslib" from "node_modules/.vite/deps/echarts-for-react.js"`

### Causes possibles

- Dépendances frontend non installées ou cache Vite obsolète.
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

## Entretien Docker (espace disque)

Pensez à nettoyer régulièrement les ressources Docker inutilisées pour éviter que le fichier `docker_data.vhdx` n'enfle (notamment sous Docker Desktop). Vous pouvez :

- Lancer le script local `./cleanup.sh` (basé sur `docker system prune` et `docker volume prune`).
- Utiliser `docker compose prune` si vous gérez plusieurs projets Compose.
- Utiliser la fonction **Clean / Purge data** dans Docker Desktop pour libérer l'espace disque.
