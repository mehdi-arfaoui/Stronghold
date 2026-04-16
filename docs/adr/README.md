# ADRs

Ce dossier contient les Architecture Decision Records du projet.

Un ADR capture une décision d'architecture durable,
le contexte dans lequel elle a été prise,
les alternatives étudiées,
et les conséquences attendues.

Le format suivi est le format ADR popularisé par Michael Nygard,
adapté au style documentaire de Stronghold.

## Numérotation

Chaque ADR suit la convention de nommage suivante :

`ADR-xxx-slug-kebab-case.md`

Exemples :

- `ADR-001-multi-account-model.md`
- `ADR-002-scan-state-encryption.md`

Règles :

- La numérotation est séquentielle.
- Un numéro n'est jamais réutilisé.
- Le slug doit rester court, stable et descriptif.
- Le fichier reste en place même si l'ADR est remplacé plus tard.

## Statuts

Chaque ADR contient un bloc `Status` en tête de document.

Les statuts utilisés dans ce dépôt sont :

- `Proposed`
  Décision en cours de revue.
  Elle peut encore évoluer sans être considérée comme normative.

- `Accepted`
  Décision validée.
  Elle devient la référence pour l'implémentation et les ADR suivants.

- `Superseded`
  Décision remplacée par un ADR plus récent.
  Le fichier historique reste conservé pour traçabilité.

## Structure attendue

Un ADR Stronghold doit, sauf exception justifiée,
contenir les sections suivantes :

- `Status`
- `Context`
- `Decision Drivers`
- `Decisions`
- `Consequences`
- `Rollout Plan`
- `References`

## Règles d'édition

- Un ADR documente un ensemble cohérent de décisions.
- Un ADR n'est pas un changelog de code.
- Une implémentation ne doit pas précéder un ADR quand la décision structure le reste de la phase.
- Un ADR accepté doit être cité par les blocs ou PRs qui en dépendent.
- Si une décision change, un nouvel ADR remplace l'ancien.
- Un ADR remplacé passe à `Superseded` et pointe vers le nouvel ADR.

## Relation entre ADR

Utiliser les champs suivants dans le bloc `Status` :

- `Supersedes`
  Numéro d'ADR remplacé,
  ou `none` si aucun.

- `Related`
  ADRs connexes,
  ou `none` si aucun.

## Style

Le style attendu est technique,
sec,
et lisible par un Principal SRE,
un Staff Engineer,
ou un RSSI sans explication orale complémentaire.

Les exemples sont autorisés lorsqu'ils clarifient la règle.

Le marketing,
les promesses produit,
et les formulations vagues sont à éviter.
