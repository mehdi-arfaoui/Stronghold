# Stronghold

## Backend – extraction de faits IA

- Copier `backend/.env.example` vers `backend/.env` et renseigner `DATABASE_URL` ainsi que `OPENAI_API_KEY` (optionnellement `OPENAI_MODEL`).
- L’endpoint `POST /analysis/documents/:id/extracted-facts?force=false` déclenche l’analyse IA d’un document déjà ingéré (champ `textContent` présent).
  - Si `force=false` et des faits existent déjà, ils sont renvoyés tels quels.
  - Si `force=true` ou aucun fait n’existe, l’API OpenAI Responses est appelée avec un schéma JSON strict pour créer des `ExtractedFact` (catégorie SERVICE/INFRA/RISK/RTO_RPO/OTHER, label, données structurées, source courte, confiance).
  - Réponse : `{ documentId, facts: [...] }`.

## Ingestion OCR des images

- L’ingestion des fichiers `image/*` peut utiliser `tesseract.js` pour extraire le texte (OCR). Installez la dépendance dans le dossier `backend` (`npm install tesseract.js`) avant d’activer cette option.
- Activez l’OCR via la variable d’environnement `OCR_ENABLED=true` (désactivée par défaut pour éviter les coûts/impacts de performance en développement). Les seuils peuvent être ajustés avec `OCR_CONFIDENCE_THRESHOLD` (par défaut à 60) et la langue avec `OCR_LANG` (par défaut `eng`).
- Si l’OCR est absente ou échoue, l’ingestion bascule automatiquement sur l’état `UNSUPPORTED` pour le document image.
