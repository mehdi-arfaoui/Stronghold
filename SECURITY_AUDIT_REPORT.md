# Rapport d'Audit de Securite — Stronghold
Date : 2026-02-17
Scope : Backend + Frontend + Infrastructure Docker

## Resume executif
- Vulnerabilites critiques : **0** (corrige)
- Vulnerabilites hautes : **0** (corrige)
- Vulnerabilites moyennes : **3** (accepted risk upstream `xml2js` via `node-nmap`/`node-wmi`)
- Frontend (`npm audit --omit=dev`) : **0**
- Credentials cloud : stockage et exposition API durcis (corrige)
- Isolation multi-tenant : aucun handler Prisma sans marqueur tenant (corrige)

## 1. Dependances
### Critical
- `form-data <2.5.4` (GHSA-fjxv-7rqg-78g4) — **corrige** via upgrade `@kubernetes/client-node@1.4.0`
- `jsonpath-plus <=10.2.0` (GHSA-pppg-cpfq-h7wr, GHSA-hw8r-x6gr-5gjp) — **corrige**

### High
- `qs <6.14.1` (GHSA-6rw7-vpxm-498p) — **corrige**
- `xlsx` (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) — **corrige** par migration vers `exceljs`

### Moderate
- `xml2js <0.5.0` via `node-nmap` / `node-wmi` — **open (accepted risk)**, pas de fix upstream disponible

### Verifications
- Backend audit final : `3 moderate, 0 high, 0 critical`
- Frontend audit final : `0 vulnerabilities`

## 2. Secrets dans le code
| Fichier | Ligne | Type | Risque | Statut |
|---------|-------|------|--------|--------|
| `scripts/pass2_smoke.ps1` | 3 | API key dev hardcodee (`dev_seed_api_key_for_local_runs`) | Faible a moyen | Open |
| `scripts/targeted_smoke_fixes.ps1` | 3 | API key dev hardcodee (`dev_seed_api_key_for_local_runs`) | Faible a moyen | Open |
| `docker-compose.yml` | 77 | URL avec user/password inline (variables env) | Faible | A surveiller |
| `docker-compose.yml` | 113 | URL avec user/password inline (variables env) | Faible | A surveiller |

Constats additionnels:
- Pattern AWS hardcode (`AKIA...`) : **aucun**
- `.env` tracke dans git : **non**
- `.gitignore` contient bien `.env` / `.env.*`

## 3. Credentials cloud
- Stockage :
  - `DiscoveryJob.credentialsCiphertext/credentialsIv/credentialsTag` : chiffre (AES-256-GCM existant)
  - `ScanJob.config` / `ScanSchedule.config` : **corrige** (chiffrement AES-256-GCM via `CREDENTIAL_ENCRYPTION_KEY`)
- Retour API :
  - `GET /api/discovery-resilience/schedules` : **corrige** (config sanitizee, credentials masquees)
  - `buildJobResponse(...)` : sanitization recursive ajoutee
- Queue/Redis :
  - `POST /api/discovery-resilience/auto-scan` : **corrige** (credentials retirees du payload BullMQ)
- Migration donnees existantes : script ajoute `scripts/migrate-encrypt-credentials.ts`

## 4. Isolation multi-tenant
Script : `scripts/audit-tenant-isolation.ts`
- Resultat final :
  - Endpoints analyses : **289**
  - Sans marqueur tenant explicite : **29** (endpoints majoritairement metadata/global)
  - Endpoints avec appel Prisma direct ET sans marqueur tenant : **0**
- Gaps corriges : wrappers explicites tenant ajoutes sur `PUT/PATCH /api/runbooks/:id` et `POST /api/reports/pra-pca|generate`

## 5. Validation des inputs
- Acces direct `req.body/params/query` : 239 occurrences (validation majoritairement manuelle)
- Raw Prisma SQL : 6 occurrences, toutes parametrees
- Command execution :
  - exec shell non-securise : **aucun**
  - hardening applique : validation stricte des chemins ZIP + `execFile` uniquement
- Frontend `dangerouslySetInnerHTML` : 4 occurrences avec `DOMPurify`

## 6. Authentification
- Mecanisme : API key (`x-api-key`) + hash SHA-256 + RBAC
- Refresh token : non
- Routes publiques : `/health/live`, `/health/ready`, `/health`, `/metrics`
- JWT env present mais non utilise comme mecanisme principal

## 7. Reseau
- Ports exposes compose : `5432`, `6379`, `8000`, `9000`, `9001`, `3000`, `4000`
- DB/Redis exposes : oui (open)
- Redis `requirepass` explicite : non (open)
- TLS compose : pas de terminaison TLS locale (open)

## Actions prioritaires
1. [HIGH] Fermer `5432/6379` cote host hors dev et imposer auth Redis.
2. [MEDIUM] Remplacer API keys dev hardcodees dans scripts smoke.
3. [MEDIUM] Durcir escaping serveur pour `/api/reports/preview`.
4. [MEDIUM] Planifier remplacement de `node-nmap` / `node-wmi` (accepted risk `xml2js`).

## Passes 2/3 — Statut
- Hardening applique avec commits separes (dependances, chiffrement, masquage, exec, tenant, logs).
- Tests securite ajoutes dans `backend/src/__tests__/security/` :
  - `tenant-isolation.security.test.ts`
  - `injection.security.test.ts`
  - `credential-exposure.security.test.ts`
  - `rate-limiting.security.test.ts`
  - `authentication.security.test.ts`
- Resultat tests securite : **16/16 pass** via `npx tsx --test src/__tests__/security/*.test.ts`

## Verification finale
- `npm audit --omit=dev` : backend `0 critical / 0 high`, frontend `0 vulnerabilities`
- `npm run build` : OK backend + frontend
- Note: la suite legacy `backend/tests/**/*.test.js` ne s'execute pas en l'etat sous Node ESM (erreurs CJS/ESM preexistantes), independamment des changements de ce lot.
