# ADR-002: Recoverability Contracts

Ce document fige le modèle des Recoverability Contracts pour la Phase 4.
Il définit le format déclaratif, les dimensions vérifiables, les verdicts, les niveaux d'enforcement, l'interaction avec le scoring, et le modèle conceptuel d'évaluation.
Il ne définit aucune implémentation.
Il sert de source de vérité pour les blocs de mise en oeuvre suivants.

## 1. Status

Status: Accepted
Date: 2026-05-27
Supersedes: none
Related: ADR-001 (Multi-Account Model)

## 2. Context

### 2.1 Problème résolu

Stronghold diagnostique aujourd'hui la posture de disaster recovery : findings DR, score, grade, Reality Gap, recovery chains faibles, dépendances critiques, et SPOFs.
Cette lecture est descriptive.
Elle expose ce que Stronghold observe, mais elle ne répond pas directement à la question : "est-ce que MON service respecte MES exigences de recovery ?"

Un rapport peut dire :

```text
Score: 45/100
Grade: D
Finding: database restore path is blocked
```

Mais il ne vérifie pas directement :

```text
payment-processing doit avoir RTO < 1h en cas de region-failure,
avec evidence testée, chain coverage prouvée, et zéro SPOF non mitigé.
```

Dans les organisations réelles, ces exigences existent souvent hors du système.
Elles vivent dans la tête d'un SRE, dans un document Confluence, dans un audit report, dans un ticket historique, ou dans une présentation de revue d'architecture.
Elles sont rarement versionnées, relues, et vérifiées automatiquement à chaque scan.

Les Recoverability Contracts résolvent ce manque.
Ils donnent à Stronghold un moyen de déclarer les exigences DR attendues, puis de les comparer aux résultats produits par le scan.

### 2.2 Différence avec OPA, Conftest et Checkov

OPA, Conftest, Checkov, et les outils proches vérifient principalement des attributs statiques de configuration.

Exemples :

```text
backup_retention > 7
encryption_enabled == true
public_access == false
multi_az == true
```

Ces règles sont utiles, mais elles ne prouvent pas un comportement de recovery.
Stronghold Contracts vérifie une composition : un scenario de disruption, un budget RTO/RPO, un niveau d'evidence, une couverture de recovery chain, et une tolérance SPOF.

La question n'est pas :

```text
Cette ressource a-t-elle un backup activé ?
```

La question est :

```text
Ce service peut-il être récupéré, sous ce scenario, dans ce budget,
avec ce niveau de preuve, sur toute la chaîne, sans SPOF non mitigé ?
```

OPA ne connaît pas le modèle de données Stronghold : services détectés, recovery chains, Full-Chain Recovery Coverage, taxonomie d'evidence, scenarios DR, SPOFs du graphe, estimations RTO/RPO null-safe, ou Reality Gap.
Le différenciateur n'est donc pas le langage de règle.
Le différenciateur est le modèle sémantique sur lequel la règle s'applique.

### 2.3 Positionnement dans Stronghold

Stronghold scoring et Stronghold contracts coexistent.
Ils répondent à deux questions différentes.

Le scoring répond :

```text
Voici la vérité objective sur votre DR.
```

Les contracts répondent :

```text
Voici vos exigences, voici si elles sont respectées.
```

Le score est descriptif et ne dépend pas des choix de l'utilisateur.
Le contrat est prescriptif et dépend des exigences déclarées par l'organisation.

Exemple de lecture combinée :

```text
Score: 45/100
Grade: D

Contracts:
  payment-processing region-failure: violated
  Reason: rto expected <= 1h, actual unknown because db-restore is blocked
```

Les deux résultats doivent être affichés ensemble, mais jamais fusionnés.

### 2.4 Pourquoi l'ADR précède le code

Les contracts touchent plusieurs frontières du produit : configuration utilisateur, validation YAML, modèle de service, scenarios, recovery chains, findings, reporting, exit codes CI, hooks, et audit trail.
Sans ADR, les premières PRs risquent de figer des choix par accident.

Cet ADR sépare trois sujets : la syntaxe du fichier, la sémantique d'évaluation, et le comportement d'enforcement.
Les blocs suivants doivent implémenter ce modèle, pas le redéfinir.

## 3. Decision Drivers

### 3.1 Composabilité

Un contrat doit pouvoir combiner n'importe quel sous-ensemble des cinq dimensions.
Un service peut exiger seulement `evidence: tested`.
Un autre peut exiger RTO, RPO, evidence, chain coverage, et SPOF.
Le format doit permettre une adoption progressive.

### 3.2 Lisibilité

Un RSSI non technique doit pouvoir lire un contrat.
Il doit comprendre le service, le scenario, l'exigence, et le niveau d'enforcement.
La lisibilité prime sur l'expressivité théorique.

### 3.3 Vérifiabilité déterministe

Même scan data, même fichier contracts, même verdict.
L'évaluation ne doit dépendre ni d'un appel externe, ni d'un modèle probabiliste, ni d'un ordre d'itération instable.

### 3.4 Opt-in et non-intrusif

Sans `.stronghold/contracts.yml`, Stronghold fonctionne identiquement.
Les contracts ajoutent une couche prescriptive.
Ils ne deviennent pas une condition d'usage.

### 3.5 Intégration CI

Un contrat violé doit pouvoir faire échouer un pipeline CI.
Ce comportement doit être explicite, configuré par contrat, et absent par défaut.

### 3.6 Extensibilité

Ajouter une dimension de vérification ne doit pas casser les contrats existants.
Le champ `version` est obligatoire.
La V1 doit être stricte, mais évolutive.

### 3.7 Cohérence avec l'existant

Stronghold utilise déjà YAML pour les fichiers déclaratifs.
Les contracts doivent rester cohérents avec `governance.yml`, `services.yml`, `overrides.yml`, et le DRP-as-Code.
La validation utilise JSON Schema, avec Ajv déjà présent depuis Phase 1 Bloc 3.

## 4. Decisions

### D1 — Format du fichier contracts

#### Décision

Les contracts sont déclarés dans `.stronghold/contracts.yml`.
Le format est YAML.
Le fichier est validé par un JSON Schema strict.
Le champ racine `version` est obligatoire, avec `version: "1"` pour la V1.
La racine contient une liste non vide `contracts`.

Exemple minimal :

```yaml
version: "1"
contracts:
  - service: "*"
    requirements:
      - scenario: "*"
        evidence: observed
```

#### Justification

YAML est déjà le format déclaratif lisible par des humains dans Stronghold.
Il supporte correctement commentaires, listes de requirements, et valeurs courtes comme `1h` ou `observed`.
Le chemin `.stronghold/contracts.yml` garde les exigences dans l'espace de configuration Stronghold, sans les mélanger à la gouvernance, aux services déclarés, ou aux overrides.
JSON Schema permet de rejeter clés inconnues, enums invalides, durées mal formées, hooks incomplets, et requirements vides.
Ajv étant déjà accepté, ce choix n'ajoute pas de dépendance.

#### Conséquences

Positives : format cohérent avec Stronghold, faible friction pour les SRE, validation automatisable en CLI et CI, versioning explicite, lisibilité RSSI.
Implémentation : parser YAML dédié, validation avant évaluation, erreurs distinctes pour syntaxe YAML et validation schema.
Négatives acceptées : YAML demande une discipline d'indentation, les anchors devront être traitées avec prudence, les utilisateurs OPA devront apprendre une syntaxe Stronghold.

#### Alternatives rejetées

CUE est rejeté : dépendance binaire ou outillage supplémentaire, courbe d'apprentissage, modèle plus puissant que nécessaire.
Rego/OPA est rejeté : orienté policy générique, pas service-centric, trop éloigné du modèle Stronghold.
TypeScript config est rejeté : nécessite runtime ou compilation TypeScript, et encourage une logique programmable.
JSON est rejeté : moins lisible, sans commentaires standard, trop verbeux pour des contrats humains.

### D2 — Granularité des contrats

#### Décision

Un contrat est déclaré par service.
Chaque contrat contient des requirements par scenario.
La granularité normative est `service × scenario`.

Exemple :

```yaml
version: "1"
contracts:
  - service: payment-processing
    description: "Payment must survive any single-region failure"
    owner: platform-team
    requirements:
      - scenario: region-failure
        rto: 1h
        rpo: 5m
        evidence: tested
        chain_coverage: proven
        spof: none
      - scenario: az-failure
        rto: 15m
        evidence: observed
```

#### Justification

Le service est l'unité fondamentale de Stronghold.
ADR-001 renforce une lecture service-centric.
Un service représente une capacité métier, potentiellement composée de plusieurs ressources et plusieurs comptes.
Les SRE et RSSI raisonnent en services critiques, pas en snapshots, subnets, instances, ou tables isolées.
Le scenario est la seconde moitié naturelle de l'exigence : perte d'AZ, perte de région, corruption de données, ou SPOF failure ne demandent pas les mêmes garanties.

#### Conséquences

Positives : alignement avec l'exploitation réelle, exigences différentes par scenario, rapports lisibles par service, base naturelle pour CI.
Implémentation : résoudre les services avant les requirements, produire plusieurs verdicts si `service` est un glob, afficher service effectif et scenario effectif.
Négatives acceptées : services mal nommés produiront `not_applicable`, nomenclature stable nécessaire, globs potentiellement nombreux.

#### Alternatives rejetées

Par resource est rejeté : trop granulaire, non aligné avec les SRE, incapable d'exprimer une chaîne de service.
Par scenario sans service est rejeté : trop global, car chaque service a des exigences différentes.
Par chain est rejeté : trop technique, fragile, peu lisible par un RSSI.

### D3 — Les 5 dimensions de vérification

#### Décision

Chaque requirement peut spécifier un sous-ensemble des cinq dimensions suivantes.

| Dimension | Type | Description | Vérification Stronghold |
|-----------|------|-------------|-------------------------|
| `rto` | duration string | RTO maximum | Compare avec le RTO estimé du service sous ce scenario. Si absent, `unknown`. |
| `rpo` | duration string | RPO maximum | Compare avec le RPO estimé. Même logique que RTO. |
| `evidence` | enum | Niveau d'evidence minimum | Vérifie le niveau minimum d'evidence sur les chain steps. |
| `chain_coverage` | enum | Couverture minimum du recovery path | Vérifie la Full-Chain Recovery Coverage. |
| `spof` | enum | Tolérance SPOF | Vérifie les SPOFs non mitigés selon la tolérance. |

Toutes ces dimensions sont optionnelles individuellement.
Un requirement avec seulement `evidence: tested` est valide.
Le schéma V1 impose toutefois au moins une dimension vérifiable ; un requirement avec seulement `scenario` est rejeté.

Ordre `evidence` :

```text
tested > declared > observed > inferred
```

Ordre `chain_coverage` :

```text
proven > observed > partial
```

Sémantique `spof` :

```text
none      = zéro SPOF non mitigé autorisé
mitigated = SPOFs acceptés seulement s'ils sont mitigés
any       = pas de vérification SPOF
```

#### Justification

Ces cinq dimensions correspondent aux signaux produits par Stronghold : Reality Gap, recovery chains, evidence, SPOF detection, et scenario coverage.
Elles composent la recoverability réelle.
Un RTO sans evidence est fragile.
Une evidence testée sans chaîne complète peut masquer une étape non couverte.
Une chaîne couverte avec SPOF non mitigé peut échouer en situation réelle.
Les contracts ne demandent pas de nouveaux calculs conceptuels ; ils vérifient des données existantes contre des seuils déclarés.

#### Conséquences

Positives : modèle expressif sans langage programmable, alignement avec Stronghold, exigences simples ou complètes, détails de violation précis, extension future possible.
Implémentation : résultat par dimension, enums comparés par rangs explicites, données absentes en `unknown`, attendu vs observé conservé.
Négatives acceptées : cinq notions à comprendre, `unknown` fréquents au début, distinction `declared` vs `observed` à documenter.

#### Alternatives rejetées

`compliance_framework` est rejeté comme dimension : c'est un label, pas une vérification de recovery.
`cost` est rejeté : Stronghold ne calcule pas encore le coût de recovery.
Dimensions obligatoires est rejeté : trop rigide, incompatible avec l'adoption progressive.
Score minimum est rejeté : mélange diagnostic et prescription, masque la raison précise de violation.

### D4 — Format des durées RTO/RPO

#### Décision

`rto` et `rpo` utilisent une chaîne de durée simplifiée.

Formats acceptés :

```text
<number>h
<number>m
<number>s
<number>h<number>m
```

Exemples valides :

```text
1h
30m
5m
24h
1h30m
45s
```

Exemples invalides :

```text
P1H
PT1H30M
90 minutes
1.5h
01h
1h 30m
1d
```

Le parser est strict, rejette les formats inconnus, et n'ajoute aucune dépendance.

#### Justification

Les durées doivent être lisibles en revue de code.
`1h` et `5m` sont immédiatement compréhensibles.
ISO 8601 complet est standard, mais `PT1H30M` est trop verbeux pour ce fichier.
Les chaînes libres sont lisibles, mais ambiguës.
Le format retenu est petit, strict, et suffisant pour la V1.

#### Conséquences

Positives : syntaxe courte, validation simple, messages d'erreur prévisibles, absence de dépendance.
Implémentation : parser maison, normalisation en secondes ou millisecondes, comparaison uniquement après normalisation.
Négatives acceptées : pas de jours, pas de décimales, pas d'ISO 8601 complet.

#### Alternatives rejetées

ISO 8601 complet est rejeté : trop verbeux pour l'usage visé.
Nombre brut en secondes est rejeté : moins lisible et source d'erreurs.
Chaînes libres sont rejetées : parsing ambigu et non déterministe.

### D5 — Verdicts des contrats

#### Décision

Chaque requirement produit un verdict parmi quatre.

| Verdict | Signification | Quand |
|---------|---------------|-------|
| `met` | L'exigence est satisfaite | Toutes les dimensions vérifiées passent. |
| `violated` | L'exigence n'est pas satisfaite | Au moins une dimension vérifiée échoue. |
| `unknown` | Stronghold ne peut pas vérifier | Les données nécessaires sont absentes ou insuffisantes. |
| `not_applicable` | La cible ne s'applique pas au scan | Le service nommé n'a pas été détecté ou un glob ne matche rien. |

L'ordre d'agrégation des dimensions est :

```text
violated > unknown > met
```

`not_applicable` est produit avant l'évaluation des dimensions, lorsque le contrat ne peut pas être relié à un service applicable.

#### Justification

`unknown` est crucial.
Stronghold ne doit jamais dire `met` quand il ne sait pas.
Un RTO non estimé ne signifie pas que le RTO est respecté.
Une chaîne sans evidence ne signifie pas que la chaîne fonctionne.
Un scenario non couvert ne signifie pas que le service est robuste.
`not_applicable` distingue l'absence de cible de l'incertitude technique.

#### Conséquences

Positives : honnêteté des résultats, distinction violation/manque de données, base solide pour CI, alignement RTO/RPO null-safe.
Implémentation : raisons détaillées, quatre verdicts comptés séparément, `unknown` exposé dans le rapport, absence de donnée jamais convertie en succès.
Négatives acceptées : `unknown` peut frustrer, les pipelines devront décider comment traiter `unknown`, le rapport devra éviter toute lecture de `unknown` comme succès.

#### Alternatives rejetées

Verdict binaire `pass` / `fail` est rejeté : il confond absence de données et succès.
Transformer toute donnée absente en violation est rejeté : trop punitif et moins précis.
Utiliser `not_applicable` pour tous les cas non vérifiables est rejeté : cela masque les gaps d'evidence.

### D6 — Position dans le pipeline

#### Décision

Les contracts s'évaluent après tous les autres stages du pipeline.
Ils consomment le résultat final du scan, après scan, normalisation, graphe, dépendances, recovery chains, scenarios, findings, scoring, governance, et history.
Les violations produisent des findings spéciaux :

```text
contract_violation
```

Ces findings sont ajoutés au rapport.
Ils ne modifient pas le score principal.

#### Justification

Les contracts composent toutes les données du pipeline.
Ils ont besoin des services, scenarios, RTO/RPO estimés, chain steps, evidence, coverage, et SPOFs.
Les évaluer avant la fin du pipeline produirait des verdicts incomplets.
Les évaluer après le scoring préserve la séparation diagnostic vs prescription.

#### Conséquences

Positives : données complètes, score inchangé, rapport intégré, explications de verdict plus riches.
Implémentation : point d'extension final, section dédiée dans le rapport, findings typés `contract_violation`, audit trail de l'évaluation.
Négatives acceptées : étape finale supplémentaire, violations trop tardives pour influencer le score, rapport plus dense.

#### Alternatives rejetées

Évaluation avant scoring est rejetée : données incomplètes et risque de mélange scoring/contracts.
Évaluation dans chaque scanner est rejetée : impossible de vérifier chains et SPOFs transverses.
Évaluation externe au pipeline est rejetée : duplication de logique et perte du modèle interne.

### D7 — Enforcement levels

#### Décision

Chaque contrat peut déclarer un niveau d'enforcement.

| Level | Comportement |
|-------|--------------|
| `warn` | Le verdict est reporté. Exit code inchangé. |
| `enforce` | Le verdict est reporté. Si `violated`, exit code = `1`. |
| `hook` | Le verdict est reporté. Si le verdict est dans `hook.on`, Stronghold appelle le webhook. Si `violated`, exit code = `1`. |

Défaut : `warn`.

Exemple :

```yaml
version: "1"
contracts:
  - service: payment-processing
    enforcement: enforce
    requirements:
      - scenario: region-failure
        rto: 1h

  - service: analytics-pipeline
    enforcement: warn
    requirements:
      - scenario: "*"
        evidence: observed

  - service: checkout
    enforcement: hook
    hook:
      type: webhook
      url: https://hooks.slack.com/services/T00/B00/xxx
      on: [violated]
    requirements:
      - scenario: az-failure
        spof: none
```

Le hook type initial est `webhook`.
Le webhook est un HTTP POST avec payload JSON.
Il est fire-and-forget.
La réponse du hook ne modifie pas le verdict.
Les hooks ne remédient rien et ne modifient aucune infrastructure.
`script` et `command` sont hors V1.

#### Justification

`warn` couvre le développement local et l'adoption progressive.
`enforce` couvre les pipelines CI/CD.
`hook` couvre les notifications Slack, PagerDuty, Jira, ou passerelles internes.
Le défaut `warn` respecte l'opt-in non intrusif.
Le webhook est le mécanisme d'intégration le plus portable pour la V1.

#### Conséquences

Positives : adoption progressive, CI native, notifications possibles, comportement explicite dans le YAML.
Implémentation : séparer évaluation et enforcement, documenter les exit codes, définir un payload webhook stable, éviter les données sensibles dans payload et audit.
Négatives acceptées : webhook URLs potentiellement secrètes, surface de sécurité supplémentaire, confusion possible entre notification et remediation.

#### Alternatives rejetées

Un seul mode bloquant est rejeté : trop brutal pour l'adoption.
Aucun enforcement CI est rejeté : cela retire une valeur majeure des contracts.
Scripts locaux en V1 sont rejetés : surface de sécurité trop forte.
Modifier le verdict selon la réponse du hook est rejeté : cela casse le déterminisme.

### D8 — Interaction avec le scoring existant

#### Décision

Les contract violations sont des findings spéciaux de type :

```text
contract_violation
```

Ils apparaissent dans le rapport.
Ils ne modifient ni le score numérique, ni le grade.

Le rapport affiche séparément :

```text
Score: 45/100
Grade: D
Contracts: 2 met, 1 violated, 0 unknown, 0 not_applicable
```

#### Justification

Le score Stronghold doit rester comparable entre scans et organisations.
Il ne doit pas dépendre d'exigences utilisateur.
Deux organisations peuvent avoir la même infrastructure, mais des contrats différents.
Leur score descriptif doit rester identique.
Leurs verdicts contractuels peuvent diverger.
Fusionner les deux créerait une incitation à affaiblir les contrats pour améliorer le score.

#### Conséquences

Positives : comparabilité préservée, prescription claire, pas de gaming du score, section de rapport dédiée.
Implémentation : distinguer findings `contract_violation`, exposer score et contracts séparément en JSON, éviter les agrégations ambiguës.
Négatives acceptées : un utilisateur peut se demander pourquoi une violation ne baisse pas le score ; le rapport devra clarifier la séparation.

#### Alternatives rejetées

Faire modifier le score par les violations est rejeté : cela confond diagnostic et prescription.
Ne pas créer de findings est rejeté : les violations seraient moins visibles et moins intégrées.
Créer un second score contractuel est rejeté : pondération arbitraire et métrique confuse.

### D9 — Service matching

#### Décision

Le champ `service` matche le service name détecté par Stronghold.
Le match exact est case-sensitive.

Valeurs possibles :

```yaml
service: payment-processing
service: "*"
service: "payment-*"
service: "*-critical"
```

`*` signifie tous les services.
Les glob patterns simples sont autorisés pour les familles de services.
Le seul caractère spécial V1 est `*`.
Si aucun service ne matche, le verdict est `not_applicable`.

#### Justification

Les service names sont les identifiants humains des capacités Stronghold.
Ils peuvent venir de CloudFormation, de tags, de topology, ou de `services.yml`.
Le match exact évite les faux positifs.
Le case-sensitive évite les collisions silencieuses.
`*` permet les baselines globales.
Les globs simples permettent `payment-*` sans introduire la complexité des regex.

#### Conséquences

Positives : lisible, service-centric, baseline globale possible, familles de services supportées.
Implémentation : résoudre les matches au moment du scan, trier pour un ordre déterministe, produire `not_applicable` si aucun match.
Négatives acceptées : renommages cassent les contrats, patterns trop larges, casse à maintenir.

#### Alternatives rejetées

Matching par ARN est rejeté : trop technique et non service-centric.
Matching case-insensitive est rejeté : risque de collisions et masquage d'erreurs.
Regex complètes sont rejetées : moins lisibles et surdimensionnées pour la V1.

### D10 — Scenario matching

#### Décision

Le champ `scenario` matche les built-in scenarios Stronghold.
Le match est exact.

Valeurs possibles :

```text
az-failure
region-failure
data-corruption
spof-failure
*
```

`*` signifie tous les scenarios couverts par le scan.
Si le scenario n'est pas reconnu, le verdict est `unknown` avec `scenario not recognized`.
Si le scenario est reconnu mais absent des résultats, le verdict est `unknown` avec `scenario not covered by scan`.
Les custom scenarios sont hors V1.

#### Justification

Un RTO ou RPO n'a pas de sens sans perturbation cible.
La perte d'AZ, la perte de région, la corruption de données, et la défaillance SPOF ne demandent pas les mêmes garanties.
Le match exact évite les corrections implicites.
Le wildcard permet les baselines sans lister tous les scenarios.
Exclure les custom scenarios de la V1 stabilise d'abord le modèle contractuel.

#### Conséquences

Positives : sémantique claire, V1 maîtrisée, messages d'erreur explicites, extension future possible.
Implémentation : centraliser les built-in scenarios, distinguer non reconnu et non couvert, résoudre `*` sur les scenarios présents, afficher le scenario effectif.
Négatives acceptées : pas de custom scenarios V1, mapping nécessaire pour taxonomies internes, typo produit `unknown`.

#### Alternatives rejetées

Custom scenarios en V1 sont rejetés : besoin d'un DSL de scenario et surface trop large.
Correction automatique des typos est rejetée : risque d'évaluer le mauvais scenario.
Scenario optionnel est rejeté : exigence ambiguë et contraire à la granularité service × scenario.

## 5. Consequences

### 5.1 Positives

Stronghold passe du diagnostic à l'enforcement DR.
Les SRE peuvent déclarer leurs exigences de recovery en code.
Les exigences deviennent versionnées, relues, et vérifiées à chaque scan.
L'intégration CI devient native via exit code.
Le système de hooks ouvre la voie à Slack, PagerDuty, Jira, ou des passerelles internes.
Le YAML reste lisible par un RSSI non technique.
Les contracts sont orthogonaux au scoring.
L'existant ne régresse pas quand aucun contrat n'est présent.

### 5.2 Négatives

Le moteur d'évaluation est plus complexe qu'une règle statique.
Il doit composer cinq dimensions, les agrégations de verdict, les globs, les wildcards, et les données absentes.
Une documentation utilisateur sera nécessaire.
Elle devra expliquer comment écrire un contrat, comment interpréter `unknown`, et comment distinguer score et contrat.
Le verdict `unknown` peut frustrer les utilisateurs ; cette frustration est préférable à une fausse assurance.
Les hooks ouvrent une surface de sécurité.
Les webhook URLs peuvent contenir des tokens.
Le payload et l'audit trail devront éviter les données sensibles.

### 5.3 Conséquences sur les invariants

`Scan is read-only` : PRÉSERVÉ.
Les contracts lisent le scan et ne modifient aucune infrastructure.

`Deterministic reasoning` : PRÉSERVÉ.
Même data, mêmes contracts, mêmes verdicts.
Les réponses de hooks ne modifient pas l'évaluation.

`Core has zero framework dependencies` : PRÉSERVÉ.
YAML parsing via `yaml`.
JSON Schema via Ajv déjà accepté.
Aucun framework externe n'est introduit.

`RTO/RPO are null for unverified values` : RENFORCÉ.
Un contrat avec `rto: 1h` sur un service sans RTO estimé produit `unknown`, jamais `met`.

`Audit trail is always on` : ÉTENDU.
Chaque évaluation de contrat doit être auditée.
L'audit doit rester non sensible : pas d'ARNs, pas d'IPs, pas de config détaillée, pas de secret webhook.

`Evidence is append-only` : PRÉSERVÉ.
Les contracts lisent l'evidence et ne la mutent jamais.

## 6. Contract YAML Schema

### 6.1 Forme YAML

Le fichier utilisateur est `.stronghold/contracts.yml`.

Forme cible :

```yaml
version: "1"
contracts:
  - service: string
    description: string
    owner: string
    enforcement: warn | enforce | hook
    hook:
      type: webhook
      url: string
      on: [violated]
    requirements:
      - scenario: string
        rto: string
        rpo: string
        evidence: tested | declared | observed | inferred
        chain_coverage: proven | observed | partial
        spof: none | mitigated | any
```

Racine :

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| `version` | oui | Version du format, `"1"` en V1. |
| `contracts` | oui | Liste non vide de contrats. |

Contrat :

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| `service` | oui | Nom, `*`, ou glob simple. |
| `description` | non | Description humaine. |
| `owner` | non | Équipe ou personne responsable. |
| `enforcement` | non | `warn`, `enforce`, `hook`. Défaut `warn`. |
| `hook` | conditionnel | Obligatoire si `enforcement: hook`. |
| `requirements` | oui | Liste non vide. |

Requirement :

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| `scenario` | oui | Built-in scenario ou `*`. |
| `rto` | non | Durée maximum. |
| `rpo` | non | Durée maximum. |
| `evidence` | non | Niveau minimum. |
| `chain_coverage` | non | Couverture minimum. |
| `spof` | non | Tolérance SPOF. |

Au moins une dimension de vérification doit être présente.

### 6.2 JSON Schema draft-07

Le schéma suivant est normatif pour la V1.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://stronghold.local/schemas/contracts.v1.schema.json",
  "title": "Stronghold Recoverability Contracts",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "contracts"],
  "properties": {
    "version": { "type": "string", "const": "1" },
    "contracts": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/contract" }
    }
  },
  "definitions": {
    "duration": {
      "type": "string",
      "pattern": "^(?:[1-9][0-9]*h(?:[1-9][0-9]*m)?|[1-9][0-9]*m|[1-9][0-9]*s)$"
    },
    "servicePattern": { "type": "string", "minLength": 1 },
    "scenarioPattern": { "type": "string", "minLength": 1 },
    "enforcement": {
      "type": "string",
      "enum": ["warn", "enforce", "hook"],
      "default": "warn"
    },
    "hookTrigger": {
      "type": "string",
      "enum": ["violated", "unknown", "met"]
    },
    "webhookHook": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "url", "on"],
      "properties": {
        "type": { "type": "string", "const": "webhook" },
        "url": {
          "type": "string",
          "minLength": 1,
          "pattern": "^https?://[^\\s]+$"
        },
        "on": {
          "type": "array",
          "minItems": 1,
          "uniqueItems": true,
          "items": { "$ref": "#/definitions/hookTrigger" }
        }
      }
    },
    "contract": {
      "type": "object",
      "additionalProperties": false,
      "required": ["service", "requirements"],
      "properties": {
        "service": { "$ref": "#/definitions/servicePattern" },
        "description": { "type": "string", "minLength": 1 },
        "owner": { "type": "string", "minLength": 1 },
        "enforcement": { "$ref": "#/definitions/enforcement" },
        "hook": { "$ref": "#/definitions/webhookHook" },
        "requirements": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/definitions/requirement" }
        }
      },
      "allOf": [
        {
          "if": {
            "properties": { "enforcement": { "const": "hook" } },
            "required": ["enforcement"]
          },
          "then": { "required": ["hook"] }
        },
        {
          "if": { "required": ["hook"] },
          "then": {
            "properties": { "enforcement": { "const": "hook" } },
            "required": ["enforcement"]
          }
        }
      ]
    },
    "requirement": {
      "type": "object",
      "additionalProperties": false,
      "required": ["scenario"],
      "properties": {
        "scenario": { "$ref": "#/definitions/scenarioPattern" },
        "rto": { "$ref": "#/definitions/duration" },
        "rpo": { "$ref": "#/definitions/duration" },
        "evidence": {
          "type": "string",
          "enum": ["tested", "declared", "observed", "inferred"]
        },
        "chain_coverage": {
          "type": "string",
          "enum": ["proven", "observed", "partial"]
        },
        "spof": {
          "type": "string",
          "enum": ["none", "mitigated", "any"]
        }
      },
      "anyOf": [
        { "required": ["rto"] },
        { "required": ["rpo"] },
        { "required": ["evidence"] },
        { "required": ["chain_coverage"] },
        { "required": ["spof"] }
      ]
    }
  }
}
```

### 6.3 Validation behavior

Le schéma valide la forme, pas le résultat d'un scan.
Il ne vérifie pas que le service existe, que le glob matche, que le scenario est connu, que le RTO est atteignable, ou que le webhook répond.
Une erreur YAML ou JSON Schema empêche l'évaluation.
Elle n'est pas un verdict `unknown`.
`unknown` est réservé aux contrats valides mais non vérifiables avec les données de scan.

## 7. Example Contracts

### 7.1 Exemple 1 — Minimal evidence only

Ce contrat exige que tous les services aient au moins une evidence observée.
Il convient à une organisation qui commence à formaliser le DR.

```yaml
version: "1"
contracts:
  - service: "*"
    description: "All services must have at least observed evidence"
    enforcement: warn
    requirements:
      - scenario: "*"
        evidence: observed
```

Lecture : tous les services et scenarios couverts sont évalués.
Une chain seulement `inferred` viole l'exigence.
`warn` ne change pas l'exit code.

### 7.2 Exemple 2 — Compliance-driven fintech

Ce contrat exprime une exigence forte pour un service de paiement.

```yaml
version: "1"
contracts:
  - service: payment-processing
    description: "PCI-DSS requires proven recovery within 1h"
    owner: platform-team
    enforcement: enforce
    requirements:
      - scenario: region-failure
        rto: 1h
        rpo: 5m
        evidence: tested
        chain_coverage: proven
        spof: none
      - scenario: data-corruption
        rpo: 1m
        evidence: tested
```

Lecture : `region-failure` exige les cinq dimensions.
`data-corruption` cible RPO et evidence.
Une violation produit exit code `1`.

### 7.3 Exemple 3 — Tiered requirements

Ce contrat applique des SLAs différents selon le scenario.

```yaml
version: "1"
contracts:
  - service: checkout
    enforcement: enforce
    requirements:
      - scenario: az-failure
        rto: 5m
        chain_coverage: proven
      - scenario: region-failure
        rto: 1h
        chain_coverage: observed
      - scenario: data-corruption
        rpo: 15m
        evidence: tested
```

Lecture : le même service a plusieurs budgets.
Les dimensions absentes ne sont pas évaluées.

### 7.4 Exemple 4 — With hook

Ce contrat notifie une équipe sur violation.
Le hook ne remédie rien.

```yaml
version: "1"
contracts:
  - service: user-auth
    enforcement: hook
    hook:
      type: webhook
      url: https://hooks.slack.com/services/T00/B00/xxx
      on: [violated]
    requirements:
      - scenario: az-failure
        rto: 5m
        spof: none
```

Lecture : le webhook se déclenche seulement sur `violated`.
La réponse HTTP ne change pas le verdict.

### 7.5 Exemple 5 — Glob pattern

Ce contrat applique une baseline forte à tous les services de paiement.

```yaml
version: "1"
contracts:
  - service: "payment-*"
    description: "All payment services must meet baseline DR"
    enforcement: enforce
    requirements:
      - scenario: az-failure
        evidence: observed
        chain_coverage: observed
      - scenario: region-failure
        evidence: tested
        chain_coverage: proven
        spof: none
```

Lecture : chaque service matché produit ses propres verdicts.
Aucun service matché produit `not_applicable`.

## 8. Evaluation Model

### 8.1 Vue conceptuelle

L'implémentation appartient au Bloc 14.

```text
Pour chaque contrat C dans contracts.yml :
  1. Résoudre le service match :
     - trouver les services du scan qui matchent C.service
     - si aucun match, produire not_applicable
     - si glob, itérer sur chaque service matché

  2. Pour chaque service S matché :
     Pour chaque requirement R dans C.requirements :
       a. Résoudre le scenario match :
          - si R.scenario vaut "*", itérer sur les scenarios couverts
          - si le scenario n'est pas reconnu, unknown("scenario not recognized")
          - si le scenario est reconnu mais absent, unknown("scenario not covered by scan")

       b. Évaluer chaque dimension spécifiée :
          - R.rto compare le RTO estimé de S sous ce scenario
          - R.rpo compare le RPO estimé de S sous ce scenario
          - R.evidence compare le niveau minimum d'evidence de la chain
          - R.chain_coverage compare la coverage de la chain
          - R.spof vérifie les SPOFs non mitigés

       c. Agréger :
          - toutes passent => met
          - au moins une échoue => violated
          - au moins une est unknown => unknown
          - priorité => violated > unknown > met

  3. Construire ContractEvaluationResult :
     - verdicts par service × requirement
     - résumé met / violated / unknown / not_applicable
     - détails attendus vs réels
```

### 8.2 Service resolution

`service: payment-processing` cherche un service exact.
`service: "*"` cible tous les services.
`service: "payment-*"` cible une famille.
Le match est case-sensitive.
L'ordre de sortie doit être déterministe, par exemple tri lexical par service name.
Si aucun service ne matche, le verdict est `not_applicable`.

### 8.3 Scenario resolution

`scenario: region-failure` cherche un scenario built-in exact.
`scenario: "*"` cible tous les scenarios couverts par le scan.
Si le scenario n'est pas reconnu, le verdict est `unknown` avec `scenario not recognized`.
Si le scenario est reconnu mais absent des résultats, le verdict est `unknown` avec `scenario not covered by scan`.

### 8.4 RTO

Si `rto` est présent, l'évaluateur lit le RTO estimé pour le service et le scenario.
Si la valeur est absente ou `null`, la dimension est `unknown`.
Si la valeur estimée est inférieure ou égale au budget, la dimension est `met`.
Si elle est supérieure, la dimension est `violated`.

```text
expected <= 1h, actual 45m => met
expected <= 1h, actual 2h => violated
expected <= 1h, actual null => unknown
```

### 8.5 RPO

La logique RPO est identique à RTO.
Absence ou `null` produit `unknown`.
Valeur inférieure ou égale au budget produit `met`.
Valeur supérieure au budget produit `violated`.

### 8.6 Evidence

Si `evidence` est présent, l'évaluateur calcule le niveau minimum sur les chain steps pertinents.

```text
tested > declared > observed > inferred
required tested, steps [tested, declared, tested] => violated
required observed, steps [tested, declared, observed] => met
no steps => unknown
```

### 8.7 Chain coverage

Si `chain_coverage` est présent, l'évaluateur lit la Full-Chain Recovery Coverage.

```text
proven > observed > partial
required proven, actual observed => violated
required observed, actual proven => met
missing coverage => unknown
```

### 8.8 SPOF

Si `spof` est présent, l'évaluateur inspecte les SPOFs applicables au service.

```text
any       => met
none      => violated si au moins un SPOF non mitigé existe
mitigated => violated si un SPOF existe sans mitigation
missing data => unknown, sauf spof:any
```

Le rapport doit décrire le type de SPOF sans exposer inutilement des identifiants sensibles.

### 8.9 Agrégation

Chaque dimension produit `met`, `violated`, ou `unknown`.
Le requirement agrège avec la priorité :

```text
violated > unknown > met
rto met, rpo unknown, evidence met => unknown
rto violated, rpo unknown, evidence met => violated
rto met, rpo met, evidence met => met
```

Cette priorité évite qu'une violation réelle soit masquée par une donnée inconnue.

### 8.10 Résultat conceptuel

Le résultat doit contenir version du fichier, contrats évalués, services matchés, requirements évalués, verdict par service et requirement, détail par dimension, résumé des counts, détails des violations, détails des unknown, et not_applicable.

Forme illustrative :

```json
{
  "summary": {
    "met": 2,
    "violated": 1,
    "unknown": 0,
    "not_applicable": 0
  },
  "results": [
    {
      "service": "payment-processing",
      "scenario": "region-failure",
      "verdict": "violated",
      "dimensions": [
        {
          "name": "rto",
          "expected": "1h",
          "actual": "2h",
          "verdict": "violated"
        }
      ]
    }
  ]
}
```

La forme exacte appartient aux Blocs 13 et 14.
La sémantique est fixée ici.

## 9. Rollout Plan

### 9.1 Bloc 13 — DSL YAML, JSON Schema, parser, types

Livrer chemin `.stronghold/contracts.yml`, JSON Schema V1, parser YAML, types dédiés, erreurs de validation, tests unitaires du parser.
Sortie : un fichier contracts valide peut être lu, validé, et transformé en modèle typé, sans évaluation.

### 9.2 Bloc 14 — Contract Evaluation Engine

Livrer résolution des services, résolution des scenarios, évaluation des cinq dimensions, agrégation des verdicts, `ContractEvaluationResult`, findings `contract_violation`, tests unitaires du moteur.
Sortie : un scan complet peut être comparé à des contracts valides.

### 9.3 Bloc 15 — Enforcement

Livrer `warn`, `enforce`, `hook`, exit code CI, webhook fire-and-forget, payload JSON, audit non sensible, tests d'enforcement.
Sortie : les contracts peuvent être utilisés comme gates CI et notifications.

### 9.4 Bloc 16 — Standard Contract Library and CLI commands

Livrer modèles de contrats standards, commandes CLI de validation, commandes CLI d'initialisation, exemples documentés, aide d'interprétation des verdicts.
Sortie : les utilisateurs peuvent démarrer avec des baselines de contracts.

## 10. References

Références de cadrage :

1. AWS Well-Architected Framework — Reliability Pillar.
   Concepts RTO, RPO, workload recovery, and disaster recovery objectives.

2. Google SRE Book — Service Level Objectives.
   Les Recoverability Contracts jouent pour le DR un rôle proche des SLOs : une exigence explicite, mesurable, et vérifiable.

3. Stronghold ADR-001 — Multi-Account Model.
   Base service-centric, identity model, evidence taxonomy, partial failure semantics, and deterministic scan boundaries.

4. JSON Schema specification draft-07.
   Base de validation stricte du fichier `.stronghold/contracts.yml`.

5. Ajv JSON Schema validator.
   Moteur de validation déjà accepté dans le périmètre Stronghold.

Consultation date :
2026-05-27
