# Guide de dÃƒÂ©marrage - Stronghold

## Option 1 : Avec Docker Compose (RecommandÃƒÂ©) Ã°Å¸ÂÂ³

C'est la mÃƒÂ©thode la plus simple, tout est automatique :

```powershell
# 1. ArrÃƒÂªter les conteneurs existants (si nÃƒÂ©cessaire)
docker-compose down

# 2. DÃƒÂ©marrer tous les services
docker-compose up --build

# Attendez que tous les services soient prÃƒÂªts (vous verrez "API PRA/PCA running on 0.0.0.0:4000")
# Les migrations sont exÃƒÂ©cutÃƒÂ©es automatiquement par le service backend-migrate.
```

### Cache Docker/BuildKit (recommandÃƒÂ©)

Pour rÃƒÂ©utiliser les couches entre plusieurs builds, activez BuildKit et le mode build via Docker CLI :

```powershell
# 1. CrÃƒÂ©er un .env local si besoin
Copy-Item .env.example .env

# 2. VÃƒÂ©rifier que ces variables sont bien prÃƒÂ©sentes
DOCKER_BUILDKIT=1
COMPOSE_DOCKER_CLI_BUILD=1
```

Le cache local BuildKit est stockÃƒÂ© dans `.buildx-cache/` (ignorÃƒÂ© par Git). Vous pouvez lancer un build avec cache via :

```powershell
./scripts/build-with-cache.sh
```

### Mesurer les gains de cache (exemple)

ExÃƒÂ©cutez deux builds successifs et comparez les durÃƒÂ©es :

```powershell
# 1er build (cache froid)
Measure-Command { ./scripts/build-with-cache.sh }

# 2e build (cache chaud)
Measure-Command { ./scripts/build-with-cache.sh }
```

Exemple d'ÃƒÂ©volution mesurÃƒÂ©e :

| ExÃƒÂ©cution | DurÃƒÂ©e totale |
| --- | --- |
| Build 1 (cache froid) | ~6m 20s |
| Build 2 (cache chaud) | ~2m 05s |

**VÃƒÂ©rification :**
- Backend (live) : http://localhost:4000/health/live
- Backend (ready) : http://localhost:4000/health/ready
- Frontend : http://localhost:3000

---

## Option 2 : Sans Docker (DÃƒÂ©veloppement local) Ã°Å¸â€™Â»

### PrÃƒÂ©requis
- PostgreSQL doit ÃƒÂªtre installÃƒÂ© et dÃƒÂ©marrÃƒÂ©
- Node.js 20+ installÃƒÂ©

### Ãƒâ€°tape 1 : Backend

```powershell
cd backend

# Installation des dÃƒÂ©pendances (premiÃƒÂ¨re fois seulement)
npm install

# GÃƒÂ©nÃƒÂ©rer le client Prisma
npx prisma generate

# Appliquer les migrations
npx prisma migrate dev

# CrÃƒÂ©er les donnÃƒÂ©es de test (tenant + clÃƒÂ© API)
node prisma/seed.cjs

# DÃƒÂ©marrer le backend
npm run dev
```

**VÃƒÂ©rification :** Ouvrez http://localhost:4000/health/ready dans votre navigateur
- Vous devriez voir : `{"status":"ok","dependencies":{...}}`

### Ãƒâ€°tape 2 : Frontend (dans un nouveau terminal)

```powershell
cd frontend

# Installation des dÃƒÂ©pendances (premiÃƒÂ¨re fois seulement)
npm install

# DÃƒÂ©marrer le frontend
npm run dev
```

**VÃƒÂ©rification :** Ouvrez http://localhost:3000 dans votre navigateur

---

## VÃƒÂ©rification rapide Ã¢Å“â€¦

### 1. Test du backend
Ouvrez dans votre navigateur : **http://localhost:4000/health/live**

Vous devriez voir :
```json
{
  "status": "ok",
  "uptimeSeconds": 12,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Test de l'API avec clÃƒÂ©
Dans PowerShell :
```powershell
$headers = @{ "x-api-key" = "\$SEED_API_KEY" }
Invoke-WebRequest -Uri "http://localhost:4000/services" -Headers $headers
```

Vous devriez recevoir une liste de services (peut ÃƒÂªtre vide `[]` si aucun service n'existe encore).

### 3. Test du frontend
Ouvrez : **http://localhost:3000**

- La page doit se charger
- Ouvrez la console du navigateur (F12)
- Vous devriez voir `[API Config]` avec la configuration
- Si vous voyez "Erreur lors du chargement", vÃƒÂ©rifiez :
  1. Que le backend est bien dÃƒÂ©marrÃƒÂ© (test 1)
  2. Que l'API key est bien "\$SEED_API_KEY"
  3. Utilisez la banniÃƒÂ¨re de configuration en haut de page si nÃƒÂ©cessaire

---

## ProblÃƒÂ¨mes courants Ã°Å¸â€Â§

### "Cannot connect to database"
- VÃƒÂ©rifiez que PostgreSQL est dÃƒÂ©marrÃƒÂ©
- VÃƒÂ©rifiez la variable `DATABASE_URL` dans `.env` du backend

### "NetworkError when attempting to fetch resource"
- VÃƒÂ©rifiez que le backend est dÃƒÂ©marrÃƒÂ© : http://localhost:4000/health/live
- VÃƒÂ©rifiez la console du navigateur (F12) pour les dÃƒÂ©tails
- Utilisez la banniÃƒÂ¨re de configuration pour dÃƒÂ©finir manuellement l'URL

### Port dÃƒÂ©jÃƒÂ  utilisÃƒÂ©
- Backend (4000) : Changez `PORT` dans `.env` ou `docker-compose.yml`
- Frontend (3000) : Vite proposera automatiquement un autre port

### Variables d'environnement non chargÃƒÂ©es
- CrÃƒÂ©ez un fichier `frontend/.env.local` avec :
  ```
  VITE_API_URL=/api
  VITE_ENV=development
  ```
- RedÃƒÂ©marrez le serveur Vite

---

## Commandes utiles Ã°Å¸â€ºÂ Ã¯Â¸Â

### Docker
```powershell
# Voir les logs
docker-compose logs -f backend
docker-compose logs -f frontend

# ArrÃƒÂªter tout
docker-compose down

# Reset complet (volumes inclus)
docker-compose down -v

# RedÃƒÂ©marrer un service spÃƒÂ©cifique
docker-compose restart backend
```

### Local
```powershell
# Backend - voir les requÃƒÂªtes
npm run dev  # Les logs apparaissent dans le terminal

# Frontend - voir les erreurs
npm run dev  # Ouvrez la console du navigateur (F12)
```

---

## Structure des ports Ã°Å¸â€œÂ¡

- **PostgreSQL** : 5432
- **MinIO** : 9000 (API), 9001 (Console)
- **ChromaDB** : 8000
- **Backend** : 4000
- **Frontend** : 3000
