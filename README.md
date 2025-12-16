# Stronghold

## Backend – extraction de faits IA

- Copier `backend/.env.example` vers `backend/.env` et renseigner `DATABASE_URL` ainsi que `OPENAI_API_KEY` (optionnellement `OPENAI_MODEL`). Les variables `ENABLE_OCR` et `CHUNK_SIZE` sont documentées ci-dessous pour préparer/paramétrer l’OCR et le découpage en segments.
- L’endpoint `POST /analysis/documents/:id/extracted-facts?force=false` déclenche l’analyse IA d’un document déjà ingéré (champ `textContent` présent).
  - Si `force=false` et des faits existent déjà, ils sont renvoyés tels quels.
  - Si `force=true` ou aucun fait n’existe, l’API OpenAI Responses est appelée avec un schéma JSON strict pour créer des `ExtractedFact` (catégorie SERVICE/INFRA/RISK/RTO_RPO/OTHER, label, données structurées, source courte, confiance).
  - Réponse : `{ documentId, facts: [...] }`.

## Formats supportés et limites d’extraction

- **Textes plats** : `.txt`, `.md`, `.json`, `.csv`, `.log`, `.yml`, `.yaml` (lecture directe du contenu).
- **Tableurs Excel** : `.xlsx`, `.xlsm`, `.xlsb` (conversion en texte structuré par feuille/ligne).
- **PDF** : extraction désactivée pour l’instant (problème de librairie `pdf-parse` côté serveur).
- **Images** : pas d’OCR aujourd’hui ; l’activation future passera par `ENABLE_OCR=true`.
- **DOCX et autres formats binaires** : non supportés pour l’instant.
- **Taille** : le texte envoyé à l’IA est tronqué à ~12 000 caractères ; au-delà, prévoir un découpage (chunking) pour limiter la perte d’information.

## Chunking (découpage des documents)

Pour éviter la perte d’information sur les documents volumineux, un découpage en segments peut être préparé :

- `CHUNK_SIZE` permet de définir la taille cible d’un segment envoyé à l’IA.
- Le chunking doit être activé et branché côté service avant d’être utilisé en production ; tant que ce n’est pas le cas, seul le tronquage à 12 000 caractères est appliqué.

## Limitations connues

- L’IA ne garantit pas une extraction 100 % fiable sur tous les documents ; une validation humaine reste nécessaire.
- L’extraction OCR et PDF n’est pas disponible pour l’instant (cf. variables d’environnement pour préparer leur activation ultérieure).
