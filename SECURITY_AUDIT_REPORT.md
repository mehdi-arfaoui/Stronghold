# Rapport d'Audit de Securite — Stronghold
Date : 2026-02-17
Scope : Backend + Frontend + Infrastructure Docker

## Resume executif
- 4 vulnerabilites critiques
- 2 vulnerabilites hautes
- 4 vulnerabilites moyennes
- Frontend (`npm audit --omit=dev`) : 0 vulnerabilite
- Risque critique applicatif : des credentials cloud peuvent etre stockees en clair (`ScanJob.config`, `ScanSchedule.config`) et exposees via API (`GET /api/discovery-resilience/schedules`)
- Risque infra : PostgreSQL et Redis exposes sur l'hote (`5432`, `6379`) + pas de mot de passe Redis force dans la config Docker

## 1. Dependances
### Critical
- `form-data <2.5.4` (GHSA-fjxv-7rqg-78g4) via `request` / `@kubernetes/client-node` — fix disponible : **oui** (`npm audit fix --force`, major sur `@kubernetes/client-node`)
- `jsonpath-plus <=10.2.0` (GHSA-pppg-cpfq-h7wr, GHSA-hw8r-x6gr-5gjp) — fix disponible : **oui** (`npm audit fix --force`, major sur `@kubernetes/client-node`)

### High
- `qs <6.14.1` (GHSA-6rw7-vpxm-498p) via `request` — fix disponible : **oui** (via upgrade major de `@kubernetes/client-node`)
- `xlsx` (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) — fix disponible : **non** (accepted risk a documenter)

### Moderate
- `tough-cookie <4.1.3` (GHSA-72xf-g2v4-qvf3) — fix disponible : **oui** (via upgrade major de `@kubernetes/client-node`)
- `xml2js <0.5.0` (GHSA-776f-qx25-q3cc) via `node-nmap` / `node-wmi` — fix disponible : **non** (accepted risk a documenter)

### Outdated (hors audit CVE)
- Backend : 36 packages obsoletes (`tmp/security-audit/npm-outdated-backend.txt`)
- Frontend : 19 packages obsoletes (`tmp/security-audit/npm-outdated-frontend.txt`)
- Majors sensibles a evaluer : `@kubernetes/client-node (0.21.0 -> 1.4.0)`, `prisma (5.21.1 -> 7.4.0)`, `tailwindcss (3 -> 4)`, `react-router-dom (6 -> 7)`

## 2. Secrets dans le code
| Fichier | Ligne | Type | Risque | Statut |
|---------|-------|------|--------|--------|
| `scripts/pass2_smoke.ps1` | 3 | API key dev hardcodee (`dev_seed_api_key_for_local_runs`) | Faible a moyen (fuite de script interne, mauvaise hygiene) | A corriger |
| `scripts/targeted_smoke_fixes.ps1` | 3 | API key dev hardcodee (`dev_seed_api_key_for_local_runs`) | Faible a moyen | A corriger |
| `docker-compose.yml` | 77 | URL avec user/password inline (variables env) | Faible (pas de secret en clair, mais fuite possible si logs/echo) | A surveiller |
| `docker-compose.yml` | 113 | URL avec user/password inline (variables env) | Faible | A surveiller |

Constats additionnels:
- Pattern AWS hardcode (`AKIA...`) : **aucun**
- URL avec credentials inline dans code TS/JSON/YML : **aucune**
- `.env` tracke dans git : **non**
- `.gitignore` contient bien les regles `.env` / `.env.*`

## 3. Credentials cloud
- Stockage :
  - `DiscoveryJob.credentialsCiphertext/credentialsIv/credentialsTag` : **chiffre** (AES-256-GCM, cle derivee de `DISCOVERY_SECRET` par SHA-256) (`backend/src/services/discoveryService.ts`)
  - `ScanJob.config` et `ScanSchedule.config` : **potentiellement en clair** (JSON contenant `providers[].credentials`) via `createScanJob` / `createScanSchedule` (`backend/src/discovery/discoveryOrchestrator.ts`)
- Retournees en API : **oui (cas critique)**
  - `GET /api/discovery-resilience/schedules` retourne `listScanSchedules(...)` sans sanitization, incluant `config` (`backend/src/routes/discoveryResilienceRoutes.ts` + `backend/src/discovery/discoveryOrchestrator.ts`)
- Presente dans les logs :
  - Pas de log explicite de credentials trouve
  - Logger applicatif masque les champs sensibles par nom de cle (`backend/src/utils/logger.ts`)
- Exposition supplementaire :
  - `POST /api/discovery-resilience/auto-scan` pousse des `credentials` en clair dans le payload BullMQ (`discoveryQueue.add(...)`), donc persistance Redis possible

## 4. Isolation multi-tenant
Script cree : `scripts/audit-tenant-isolation.ts`
- Sorties :
  - `tmp/security-audit/tenant-isolation-audit.json`
  - `tmp/security-audit/tenant-isolation-audit.csv`
- Resultat global :
  - Endpoints analyses : **289**
  - Endpoints avec marqueur tenant explicite : **256**
  - Endpoints sans marqueur tenant explicite : **33**
  - Endpoints avec appel Prisma direct ET sans marqueur tenant explicite : **0**

| Endpoint | Methode | Filtre tenant | Risque |
|----------|---------|---------------|--------|
| `/api/financial/summary` | GET | oui | Faible |
| `/api/discovery/status/:jobId` | GET | oui | Faible |
| `/api/runbooks/:id` | PUT/PATCH | non (detecteur statique), mais handler delegue verifie `tenantId` | Moyen (faux positif potentiel) |
| `/api/reports/generate` | POST | non (detecteur statique), mais `handleReportGeneration` verifie `tenantId` | Moyen (faux positif potentiel) |
| `/api/knowledge-base` | GET | non (contenu global) | Moyen / intentionnel |
| `/api/pricing/providers` | GET | non (metadonnees globales) | Moyen / intentionnel |
| `/api/cyber-scenarios` | GET | non (catalogue global) | Moyen / intentionnel |

Note : la liste exhaustive est dans `tmp/security-audit/tenant-isolation-audit.csv`.

## 5. Validation des inputs
- Endpoints avec acces direct `req.body/req.params/req.query` : **239** occurrences (validation majoritairement manuelle)
- Raw queries Prisma : **6** occurrences (`$queryRaw`), parametrees via tagged template dans les fichiers audites
- Executions de commandes :
  - **2** usages `execFile` (`documentIngestionService`, `sensitiveDataScanService`) avec arguments separes
  - **1** execution distante SSH fixe (`client.exec("uname -a")`) sans injection utilisateur directe
- Frontend `dangerouslySetInnerHTML` : **4** occurrences dans `KnowledgeBasePage.tsx`, avec `DOMPurify` en amont
- Exports/preview HTML/PDF :
  - `GET /api/reports/preview` construit du HTML en concatenant des lignes sans escaping explicite (`<p>${line}</p>`) -> risque XSS indirect si donnees amont contiennent du HTML/script

## 6. Authentification
- Mecanisme : **API key header (`x-api-key`) + hash SHA-256 en base + RBAC (`READER`/`OPERATOR`/`ADMIN`)**
- JWT : variables env presentes (`JWT_SECRET`) mais pas d'usage effectif comme mecanisme principal sur les routes auditees
- Refresh tokens : **non trouves**
- Routes non protegees (hors tenant middleware) :
  - `GET /health/live`
  - `GET /health/ready`
  - `GET /health`
  - `GET /metrics`

## 7. Reseau
- Ports exposes (`docker-compose.yml`) : `5432`, `6379`, `8000`, `9000`, `9001`, `3000`, `4000`
- DB/Redis exposes : **oui** (`5432:5432`, `6379:6379`)
- Redis password / requirepass : **non configure explicitement** (URL par defaut `redis://redis:6379`, pas de `requirepass`)
- HTTPS/TLS :
  - App : headers HSTS actifs via Helmet
  - Transport Docker local : HTTP clair (pas de terminaison TLS dans compose)

## Actions prioritaires
1. [CRITICAL] Supprimer le stockage/exposition en clair des credentials cloud dans `ScanJob.config` et `ScanSchedule.config`; ne jamais retourner `config.providers[].credentials` en API.
2. [CRITICAL] Supprimer les credentials du payload BullMQ (`discoveryQueue.add`) ou les remplacer par reference securisee; verifier retention des jobs Redis.
3. [HIGH] Corriger les CVE critiques/hautes npm (upgrade ciblee `@kubernetes/client-node` ou remplacement de la chaine `request/jsonpath-plus`).
4. [HIGH] Fermer les ports host-level de Postgres/Redis en environnement non-dev et imposer auth Redis.
5. [MEDIUM] Durcir la generation HTML de `/api/reports/preview` (escaping/sanitization serveur).
6. [MEDIUM] Remplacer les API keys dev hardcodees dans les scripts par variables d'environnement.
7. [MEDIUM] Documenter les "accepted risk" sans correctif immediat (`xlsx`, `xml2js`) avec plan de migration.

## Statut Pass 1
- Cette passe est **audit only** (aucune correction appliquee).
- Artefacts bruts d'audit disponibles dans `tmp/security-audit/`.
