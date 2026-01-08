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
- **Images** (`image/*`) : toujours non supportées (OCR à activer ultérieurement).

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

### Découverte (import)
- `POST /discovery/import` : import d’un fichier CSV ou JSON pour créer des nœuds et dépendances.

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
