# Stronghold

## Backend – extraction de faits IA

- Copier `backend/.env.example` vers `backend/.env` et renseigner `DATABASE_URL` ainsi que `OPENAI_API_KEY` (optionnellement `OPENAI_MODEL`).
- L’endpoint `POST /analysis/documents/:id/extracted-facts?force=false` déclenche l’analyse IA d’un document déjà ingéré (champ `textContent` présent).
  - Si `force=false` et des faits existent déjà, ils sont renvoyés tels quels.
  - Si `force=true` ou aucun fait n’existe, l’API OpenAI Responses est appelée avec un schéma JSON strict pour créer des `ExtractedFact` (catégorie SERVICE/INFRA/RISK/RTO_RPO/OTHER, label, données structurées, source courte, confiance).
  - Réponse : `{ documentId, facts: [...] }`.

### Extraction de texte supportée

- **PDF** : extraction textuelle activée via `pdf-parse`.
- **DOCX/PPTX** : extraction textuelle via décompression OpenXML (zip) et lecture XML interne.
- **Excel** (`.xlsx/.xlsm/.xlsb`) et **fichiers texte** (`.txt/.md/.json/.csv/.log/.yml/.yaml`) : support inchangé.
- **OCR (PDF scannés/images)** : activé via Tesseract, avec bascule possible vers AWS Textract si configuré.
  - Installer Tesseract : `sudo apt install tesseract-ocr libtesseract-dev` ou `sudo backend/scripts/install-ocr.sh`.
  - Activer Textract en fallback : `AWS_TEXTRACT_ENABLED=true` + `AWS_TEXTRACT_REGION=...`.
  - Forcer un provider : `OCR_PROVIDER=aws_textract` ou `OCR_PROVIDER=tesseract`.
  - En cas d'erreur "tesseract manquant", consultez `TROUBLESHOOTING.md` (section OCR) pour la marche à suivre.

## Déploiement SaaS / On‑premise

La configuration `DEPLOYMENT_MODE` active le mode SaaS (multi‑tenant mutualisé, schéma par tenant, quotas) ou on‑premise (licence unique, auto‑mise à jour désactivée). Le guide d’installation automatisée avec Helm est détaillé dans `DEPLOYMENT.md`.

## Schémas de données (backend)
Les modèles sont définis dans `backend/prisma/schema.prisma`. Les principaux objets utilisés par les endpoints récents :

- **BusinessProcess (BIA)** : `name`, `description`, `owners`, `rtoHours`, `rpoMinutes`, `mtpdHours`, `financialImpactLevel`, `regulatoryImpactLevel`, `impactScore`, `criticalityScore`, et liens vers `Service` via `BusinessProcessService`.
- **Risk** : `title`, `description`, `threatType`, `probability`, `impact`, `status`, `owner`, `processName`, lien optionnel vers `Service` et mitigations via `RiskMitigation`.
- **Incident** : `title`, `description`, `status`, `detectedAt`, `responsibleTeam`, liens vers `Service` (`IncidentService`) et `Document` (`IncidentDocument`), actions via `IncidentAction`.
- **Exercise** : `title`, `description`, `scheduledAt`, `status`, lien vers `Scenario`, runbooks via `ExerciseRunbook`, checklist via `ExerciseChecklistItem`, résultats via `ExerciseResult`, analyses via `ExerciseAnalysis`.

## APIs REST (extrait)
Authentification par `x-api-key` (tenant + rôle) via `backend/src/middleware/tenantMiddleware.ts`.

### BIA
- `POST /bia/processes` : création d’un processus BIA (calcule `impactScore`, `criticalityScore`).
- `GET /bia/processes` : liste des processus BIA.

### Risques
- `GET /risks` : liste des risques enrichis (score + niveau).
- `GET /risks/matrix` : matrice de risque (probabilité x impact).
- `POST /risks` : création d’un risque avec mitigations optionnelles.
- `PUT /risks/:id` : mise à jour d’un risque.
- `POST /risks/:id/mitigations` : ajout d’une mitigation.

### Incidents
- `GET /incidents` : liste des incidents.
- `GET /incidents/:id` : détail d’un incident.
- `POST /incidents` : création d’incident + action initiale.
- `PATCH /incidents/:id` : mise à jour + traçabilité des changements.
- `GET /incidents/dashboard` : résumé + incidents récents.
- `GET/POST/PATCH /incidents/notification-channels` : gestion des canaux n8n.
- `GET /incidents/:id/actions` / `POST /incidents/:id/actions` : suivi d’actions.

### Documents & uploads
- `POST /documents` : upload multipart vers S3 + scan de données sensibles.
- `POST /documents/presign` : URL signée pour upload direct côté client.
- `GET /documents` : liste + `signedUrl` (si stockage S3).
- `GET /documents/:id/sensitivity-report` : rapport de sensibilité (PII/IBAN/etc.).
- `GET /documents/:id/extraction-suggestions` : suggestions d’extraction IA.
- `POST /documents/:id/extraction-suggestions/approve` : validation des suggestions.
- `POST /documents/:id/extraction-suggestions/reject` : rejet des suggestions.

### IA & RAG
- `POST /analysis/rag-query` : question ad-hoc + contexte RAG + prompt.
- `POST /analysis/pra-rag-report` : génération d’un rapport PRA/PCA assisté RAG.
- `POST /analysis/documents/:id/classification-feedback` : feedback humain sur la classification.

### Runbooks
- `POST /runbooks/templates` : upload d’un template (DOCX/ODT/Markdown).
- `GET /runbooks/templates` / `GET /runbooks/templates/:id` : listing + détail.
- `PUT/DELETE /runbooks/templates/:id` : mise à jour/suppression.
- `GET /runbooks` / `GET /runbooks/:id` : runbooks générés.
- `PUT/DELETE /runbooks/:id` : mise à jour/suppression.
- `POST /runbooks/generate` : génération d’un runbook depuis un scénario.

### Découverte (import)
- `POST /discovery/import` : import d’un fichier CSV ou JSON pour créer des nœuds et dépendances.
- `POST /discovery/suggestions` : prévisualise les correspondances entre éléments découverts et services existants.
- `POST /discovery/run` ou `/discovery/scan` : lance un scan réseau/cloud asynchrone (SNMP/SSH/WMI à brancher côté worker).
- `POST /discovery/github-import` : importe un export JSON depuis un dépôt GitHub public (repo + chemin de fichier ou URL raw).
- `POST /discovery-resilience/seed-demo` : exécute l'onboarding démo complet (seed + analyses + artefacts simulés).
  Disponible uniquement en `development` / `test`, ou en environnement explicitement démo (`ALLOW_DEMO_SEED=true` ou `APP_ENV=demo`).

Note securite dependances discovery:
- `node-nmap` et `node-wmi` trainent une dependance transitive `xml2js` avec un risque modere connu.
- Statut actuel: risque accepte temporairement (surface limitee aux workers de discovery).
- Plan: remplacement de `node-nmap` et `node-wmi` par des adaptateurs maintenus sans `xml2js`.

Payload JSON attendu pour `/discovery/scan` :
```json
{
  "ipRanges": ["10.0.0.0/24", "10.0.1.0/24"],
  "cloudProviders": ["aws", "azure"],
  "credentials": {
    "aws": { "accessKeyId": "REDACTED", "secretAccessKey": "REDACTED" },
    "azure": { "tenantId": "REDACTED", "clientId": "REDACTED", "clientSecret": "REDACTED" }
  }
}
```

**Import GitHub (exemple rapide)**
```bash
node backend/scripts/import-github-discovery.mjs \
  --backend http://localhost:4000 \
  --api-key "$SEED_API_KEY" \
  --repo https://github.com/organisation/infra-discovery \
  --file exports/discovery.json \
  --ref main
```

Payload JSON attendu pour `/discovery/github-import` :
```json
{
  "repoUrl": "https://github.com/organisation/infra-discovery",
  "filePath": "exports/discovery.json",
  "ref": "main"
}
```

**CSV attendu**
- Header obligatoire : `record_type,id,name,type,source,target,dependency_type`.
- `record_type` vaut `node` ou `edge`.
- Lignes `node` : `id`, `name`, `type` requis (les autres champs peuvent être vides).
- Lignes `edge` : `source`, `target` requis (optionnel : `dependency_type`).

Exemple minimal CSV :
```csv
record_type,id,name,type,source,target,dependency_type
node,svc-1,Service API,SERVICE,,,
node,db-1,Database,DB,,,
edge,,,,svc-1,db-1,dépendance
```

**JSON minimal**
```json
{
  "nodes": [
    { "id": "svc-1", "name": "Service API", "type": "SERVICE" },
    { "id": "db-1", "name": "Database", "type": "DB" }
  ],
  "edges": [
    { "source": "svc-1", "target": "db-1", "dependency_type": "dépendance" }
  ]
}
```

### Exercices (planification de tests)
- `POST /exercises` : planification d’un exercice avec checklist auto-générée.
- `GET /exercises` : liste des exercices.
- `GET /exercises/:id` : détail d’un exercice.
- `PATCH /exercises/:id` : mise à jour d’un exercice.
- `PATCH /exercises/:id/checklist/:itemId` : mise à jour d’un item de checklist.
- `POST /exercises/:id/results` : saisie des résultats d’exercice.
- `POST /exercises/:id/analysis` : génération d’analyse automatisée.
- `GET /exercises/:id/report` : rapport synthétique.
