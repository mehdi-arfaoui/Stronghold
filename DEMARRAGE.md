# Guide de démarrage - Stronghold

## Option 1 : Avec Docker Compose (Recommandé) 🐳

C'est la méthode la plus simple, tout est automatique :

```powershell
# 1. Arrêter les conteneurs existants (si nécessaire)
docker-compose down

# 2. Démarrer tous les services
docker-compose up --build

# Attendez que tous les services soient prêts (vous verrez "API PRA/PCA running on 0.0.0.0:4000")
# Les migrations sont exécutées automatiquement par le service backend-migrate.
```

### Cache Docker/BuildKit (recommandé)

Pour réutiliser les couches entre plusieurs builds, activez BuildKit et le mode build via Docker CLI :

```powershell
# 1. Créer un .env local si besoin
Copy-Item .env.example .env

# 2. Vérifier que ces variables sont bien présentes
DOCKER_BUILDKIT=1
COMPOSE_DOCKER_CLI_BUILD=1
```

Le cache local BuildKit est stocké dans `.buildx-cache/` (ignoré par Git). Vous pouvez lancer un build avec cache via :

```powershell
./scripts/build-with-cache.sh
```

### Mesurer les gains de cache (exemple)

Exécutez deux builds successifs et comparez les durées :

```powershell
# 1er build (cache froid)
Measure-Command { ./scripts/build-with-cache.sh }

# 2e build (cache chaud)
Measure-Command { ./scripts/build-with-cache.sh }
```

Exemple d'évolution mesurée :

| Exécution | Durée totale |
| --- | --- |
| Build 1 (cache froid) | ~6m 20s |
| Build 2 (cache chaud) | ~2m 05s |

**Vérification :**
- Backend (live) : http://localhost:4000/health/live
- Backend (ready) : http://localhost:4000/health/ready
- Frontend : http://localhost:3000

---

## Option 2 : Sans Docker (Développement local) 💻

### Prérequis
- PostgreSQL doit être installé et démarré
- Node.js 20+ installé

### Étape 1 : Backend

```powershell
cd backend

# Installation des dépendances (première fois seulement)
npm install

# Générer le client Prisma
npx prisma generate

# Appliquer les migrations
npx prisma migrate dev

# Créer les données de test (tenant + clé API)
node prisma/seed.cjs

# Démarrer le backend
npm run dev
```

**Vérification :** Ouvrez http://localhost:4000/health/ready dans votre navigateur
- Vous devriez voir : `{"status":"ok","dependencies":{...}}`

### Étape 2 : Frontend (dans un nouveau terminal)

```powershell
cd frontend

# Installation des dépendances (première fois seulement)
npm install

# Démarrer le frontend
npm run dev
```

**Vérification :** Ouvrez http://localhost:3000 dans votre navigateur

---

## Vérification rapide ✅

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

### 2. Test de l'API avec clé
Dans PowerShell :
```powershell
$headers = @{ "x-api-key" = "dev-key" }
Invoke-WebRequest -Uri "http://localhost:4000/services" -Headers $headers
```

Vous devriez recevoir une liste de services (peut être vide `[]` si aucun service n'existe encore).

### 3. Test du frontend
Ouvrez : **http://localhost:3000**

- La page doit se charger
- Ouvrez la console du navigateur (F12)
- Vous devriez voir `[API Config]` avec la configuration
- Si vous voyez "Erreur lors du chargement", vérifiez :
  1. Que le backend est bien démarré (test 1)
  2. Que l'API key est bien "dev-key"
  3. Utilisez la bannière de configuration en haut de page si nécessaire

---

## Problèmes courants 🔧

### "Cannot connect to database"
- Vérifiez que PostgreSQL est démarré
- Vérifiez la variable `DATABASE_URL` dans `.env` du backend

### "NetworkError when attempting to fetch resource"
- Vérifiez que le backend est démarré : http://localhost:4000/health/live
- Vérifiez la console du navigateur (F12) pour les détails
- Utilisez la bannière de configuration pour définir manuellement l'URL

### Port déjà utilisé
- Backend (4000) : Changez `PORT` dans `.env` ou `docker-compose.yml`
- Frontend (3000) : Vite proposera automatiquement un autre port

### Variables d'environnement non chargées
- Créez un fichier `frontend/.env.local` avec :
  ```
  VITE_BACKEND_URL=http://localhost:4000
  VITE_API_KEY=dev-key
  ```
- Redémarrez le serveur Vite

---

## Commandes utiles 🛠️

### Docker
```powershell
# Voir les logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Arrêter tout
docker-compose down

# Reset complet (volumes inclus)
docker-compose down -v

# Redémarrer un service spécifique
docker-compose restart backend
```

### Local
```powershell
# Backend - voir les requêtes
npm run dev  # Les logs apparaissent dans le terminal

# Frontend - voir les erreurs
npm run dev  # Ouvrez la console du navigateur (F12)
```

---

## Structure des ports 📡

- **PostgreSQL** : 5432
- **MinIO** : 9000 (API), 9001 (Console)
- **ChromaDB** : 8000
- **Backend** : 4000
- **Frontend** : 3000
