# Stronghold

## Backend – extraction de faits IA

- Copier `backend/.env.example` vers `backend/.env` et renseigner `DATABASE_URL` ainsi que `OPENAI_API_KEY` (optionnellement `OPENAI_MODEL`).
- L’endpoint `POST /analysis/documents/:id/extracted-facts?force=false` déclenche l’analyse IA d’un document déjà ingéré (champ `textContent` présent).
  - Si `force=false` et des faits existent déjà, ils sont renvoyés tels quels.
  - Si `force=true` ou aucun fait n’existe, l’API OpenAI Responses est appelée avec un schéma JSON strict pour créer des `ExtractedFact` (catégorie SERVICE/INFRA/RISK/RTO_RPO/OTHER, label, données structurées, source courte, confiance).
  - Réponse : `{ documentId, facts: [...] }`.
