# ARCHI MVP - Outil PRA/PCA auto-hébergé

## Objectif
Boîte logicielle (appliance) déployable chez le client, permettant :
- de saisir les services, dépendances, RTO/RPO/MTPD,
- d’uploader les documents d’architecture,
- d’utiliser un agent IA spécialisé PRA/PCA pour analyser ces infos,
- de générer un rapport PRA/PCA.

## Composants
- backend (Node.js/TypeScript/Express) : API, logique métier, appels IA.
- frontend (React/Next.js) : questionnaire, dashboard, upload.
- PostgreSQL : stockage structuré des données PRA.
- MinIO : stockage des documents (PDF, DOCX, images) en local.
- ChromaDB (ou Qdrant) : index d’embedding par client (ici : instance unique).
- n8n : orchestration (ingestion, vectorisation, génération de rapport).
- Service IA interne : classification documentaire, extraction de faits, RAG et génération de runbooks.

## Données
Toutes les données (DB, docs, embeddings) restent dans l’infrastructure du client.
Les appels IA ne servent qu’à la génération de réponses et rapports, pas à entraîner les modèles.

## Mode de déploiement
- Un `docker-compose.yml` lance tous les services.
- Un fichier `.env` permet de configurer les mots de passe, ports, etc.
- Mises à jour via nouvelles images Docker et migrations de base.

## Services backend & endpoints clés
- **Upload documentaire sécurisé** : `POST /documents`, `POST /documents/presign`, `GET /documents`.
- **Sensibilité & classification** : `GET /documents/:id/sensitivity-report`, `POST /analysis/documents/:id/classification-feedback`.
- **RAG & rapports** : `POST /analysis/rag-query`, `POST /analysis/pra-rag-report`.
- **Runbooks** : `POST /runbooks/templates`, `POST /runbooks/generate`, `GET /runbooks`.
- **Navigation UI** : route frontend `/navigation` pour explorer les modules et filtres.

## Flux n8n (orchestration)
Les flux n8n sont appelés par des webhooks ou par l’API backend :

- **Ingestion documentaire** : endpoint `POST /webhooks/n8n/document-ingestion` pour déclencher la chaîne d’ingestion, enrichie par `API_PUBLIC_URL` (voir `backend/src/services/documentIngestionService.ts`).
- **Notifications d’incident** : les canaux de notification stockent `n8nWebhookUrl` (table `NotificationChannel`) et reçoivent un payload enrichi lors de `incident.created` / `incident.updated` (`backend/src/services/incidentNotificationService.ts`).

Chaque flux doit rester isolé par tenant (inclusion de `tenantId` dans les payloads) et ne pas exfiltrer de données sensibles.
