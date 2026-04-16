# ADR-001: Multi-Account Model

Ce document fige le modèle d'architecture multi-account pour la Phase 1.

Il définit les contraintes de modélisation,
d'identité,
d'authentification,
d'isolation des credentials,
de tolérance aux pannes partielles,
et de restitution des résultats.

Il sert de source de vérité pour tous les blocs de mise en oeuvre qui suivent.

## 1. Status

Status: Accepted
Date: 2026-04-16
Supersedes: none
Related: none

## 2. Context

### 2.1 Situation actuelle

Stronghold fonctionne aujourd'hui sur un modèle single-account.

Le périmètre implicite du scan correspond à un seul compte AWS,
un seul contexte d'authentification,
et un seul espace de ressources considéré comme complet.

Cette hypothèse n'est pas seulement présente dans l'interface CLI.

Elle irrigue aussi la modélisation interne,
la manière dont les ressources sont identifiées,
les frontières implicites des scanners,
le graphe de dépendances,
et le rapport final.

Dans l'état actuel,
la question "quel compte est à l'origine de cette ressource"
est souvent inutile,
parce qu'elle est supposée connue par construction.

Le code peut donc,
par endroits,
traiter l'account boundary comme un contexte externe plutôt que comme une propriété explicite des données.

Cette hypothèse devient fausse dès que plusieurs comptes sont présents dans un même scan.

Le passage au multi-account ne consiste donc pas à ajouter un simple tableau de comptes au CLI.

Il impose de rendre explicites des frontières qui étaient implicites.

Il impose aussi de préciser quelle identité est canonique pour une ressource,
comment une dépendance cross-account est représentée,
comment une erreur partielle est reflétée dans le rapport,
et comment les credentials sont isolés.

### 2.2 Limitation business

Le modèle single-account répond correctement aux environnements simples,
aux laboratoires,
ou aux équipes qui concentrent leur plateforme dans un seul compte.

Il devient cependant insuffisant pour la majorité des déploiements de production structurés.

Dans la pratique,
les scale-ups opèrent fréquemment entre 2 et 10 comptes AWS.

Cette répartition reflète souvent :

- un découpage `prod` / `staging` / `sandbox`,
- une séparation par domaine métier,
- une isolation des workloads sensibles,
- une spécialisation par plateforme partagée,
- ou une organisation par équipe.

Dans les environnements enterprise,
la norme est encore plus nette.

Les groupes structurés opèrent couramment entre 50 et 500 comptes AWS,
avec une combinaison de comptes applicatifs,
comptes réseau,
comptes sécurité,
comptes partagés,
et comptes de plateforme.

Dans ce contexte,
un scan DR mono-compte ne répond qu'à une fraction du risque réel.

Il masque en particulier les dépendances suivantes :

- une application hébergée dans un compte A qui dépend d'un datastore en compte B,
- une clé KMS centrale utilisée par plusieurs comptes,
- un Transit Gateway partagé,
- des zones Route53 partagées,
- des snapshots ou buckets répliqués hors du compte principal,
- des mécanismes IAM cross-account qui conditionnent la capacité de reprise.

Le besoin business n'est donc pas :
"pouvoir lancer la même chose plusieurs fois de suite sur plusieurs comptes".

Le besoin business est :
"obtenir une posture DR unifiée sur un périmètre multi-account réel,
avec les dépendances transverses visibles,
et sans perdre la possibilité de traiter des échecs partiels".

### 2.3 Pourquoi il s'agit d'une évolution architecturale

Cette évolution touche au modèle de base de Stronghold.

Elle change :

- l'identité primaire d'une ressource,
- l'identité des noeuds dans le graphe,
- la stratégie d'authentification,
- la gestion de la durée de vie des credentials,
- la manière de propager les erreurs,
- la sémantique des absences de données,
- et la forme par défaut du rapport.

Ces sujets sont transverses.

Ils impactent le scan,
la construction du graphe,
la validation,
les recommandations,
la restitution,
et les futurs contrats de données.

Une feature additive aurait pu rester confinée à une nouvelle sous-commande,
à un nouveau rapport,
ou à une extension locale du pipeline.

Ce n'est pas le cas ici.

Le multi-account impose de clarifier des invariants avant toute implémentation,
sinon chaque bloc réintroduira une hypothèse différente.

Sans ADR,
le risque est de voir apparaître :

- plusieurs schémas d'identité concurrents,
- plusieurs conventions de node id,
- des caches de credentials mal isolés,
- des comportements divergents en cas d'échec partiel,
- et des contrats de sortie difficiles à stabiliser.

L'ADR précède donc volontairement le code.

Il évite de figer des décisions par accident dans les premières PRs d'implémentation.

### 2.4 Exigences typiques d'un RSSI et d'un Principal SRE

Un Principal SRE attend d'un outil de scan multi-account qu'il soit opérable à grande échelle,
prévisible,
et robuste face aux conditions dégradées.

Un RSSI attend qu'il respecte strictement les frontières de confiance,
les principes de moindre privilège,
et l'isolation des credentials.

Le modèle retenu doit donc satisfaire simultanément plusieurs attentes.

Première attente :
l'authentification doit être flexible.

Un parc AWS moderne combine souvent plusieurs modes d'accès légitimes :

- profils AWS locaux pour les environnements simples,
- AssumeRole pour les organisations centralisées,
- IAM Identity Center / SSO pour les postes administrés et les workflows modernes.

Deuxième attente :
les credentials doivent être isolés par compte.

Le fait de scanner plusieurs comptes dans une même commande ne doit jamais créer
un espace de credentials partagé où les frontières deviennent floues.

Troisième attente :
le système doit accepter l'échec partiel.

Dans une grande organisation,
il est fréquent qu'un compte soit temporairement inaccessible,
mal configuré,
verrouillé par une SCP,
ou simplement absent du poste de l'opérateur.

Ce cas ne doit pas invalider tout le scan.

Quatrième attente :
l'identité des ressources doit être fondée sur un identifiant AWS natif,
portable,
et directement corrélable aux logs,
aux IAM policies,
et à la documentation opérationnelle.

Une identité basée sur l'ARN répond directement à ce besoin.

Cinquième attente :
le modèle doit rester compatible avec le principe de moindre privilège.

Chaque compte peut,
et doit souvent,
être scanné avec des droits minimaux adaptés à ce compte.

Le design ne doit pas présupposer un super-credential omniscient unique.

Sixième attente :
la sémantique d'incertitude doit être explicite.

Si une dépendance cross-account ne peut pas être évaluée parce qu'un endpoint n'a pas été scanné,
le rapport doit dire `incomplete`,
pas `absent`.

La différence est majeure pour un outil DR.

## 3. Decision Drivers

### 3.1 Cohérence avec les invariants Stronghold

Le premier driver est la préservation des invariants du produit.

Le scan reste read-only.

Le coeur reste un module TypeScript pur,
sans dépendance framework.

Les données sensibles restent null-safe et explicitement modélisées.

Le multi-account ne doit pas obtenir sa flexibilité au prix d'une dette de structure
qui contredirait les choix déjà actés par Stronghold.

### 3.2 Compatibilité avec AWS Organizations et hors Organizations

Le deuxième driver est la compatibilité avec deux réalités de terrain.

Certaines entreprises utilisent AWS Organizations de manière stricte,
avec des rôles homogènes et une hiérarchie de comptes claire.

D'autres opèrent un ensemble de comptes disjoints,
parfois acquis progressivement,
parfois partagés entre partenaires,
parfois gérés sans Organizations.

Le modèle multi-account doit couvrir les deux cas.

Il serait insuffisant d'optimiser uniquement pour Organizations.

Il serait tout aussi insuffisant de n'optimiser que pour des comptes isolés.

### 3.3 Compatibilité avec les modes d'authentification modernes

Le troisième driver est la couverture des modes d'authentification réellement rencontrés en production.

Stronghold doit fonctionner avec :

- des profils nommés,
- des rôles assumés,
- et des sessions SSO actives.

Le design ne doit pas enfermer l'utilisateur dans une seule école d'administration AWS.

Il doit aussi permettre un forçage explicite,
car l'autodétection seule devient ambiguë dans certains postes de travail complexes.

### 3.4 Support des dépendances cross-account

Le quatrième driver est fonctionnel.

Le multi-account n'a d'intérêt que si Stronghold peut représenter
et restituer les dépendances transverses qui changent réellement la posture DR.

Le périmètre minimal visé inclut notamment :

- VPC peering,
- KMS cross-account grants,
- chaînes IAM AssumeRole,
- Transit Gateway attachments,
- et Route53 shared zones.

Le modèle d'identité et de graphe doit donc permettre de relier sans ambiguïté
des ressources appartenant à des comptes différents.

### 3.5 Gestion propre de la partial failure

Le cinquième driver est l'utilisabilité en contexte réel.

Un scan multi-account en production rencontre forcément des cas d'échec partiel.

Le système doit conserver un résultat utile,
tout en exposant honnêtement la zone d'incertitude.

Le modèle doit éviter deux écueils symétriques :

- l'échec total pour une panne locale,
- et le silence trompeur qui fait passer de l'inconnu pour de l'absence.

### 3.6 Isolation stricte des credentials

Le sixième driver est la sécurité opérationnelle.

Dans un scan multi-account,
les credentials ne sont pas un détail de plomberie.

Ils deviennent un axe de conception.

Le système doit garantir,
au niveau du modèle,
qu'un compte est scanné dans un contexte de credentials propre,
avec sa propre durée de vie,
ses propres limites,
et son propre audit context.

Cette isolation doit rester vraie même quand les comptes sont scannés en parallèle.

## 4. Decisions

### D1 — Resource Identity

#### Décision

L'identité primaire canonique d'une ressource AWS dans Stronghold est son ARN.

Cette règle vaut pour la représentation interne,
pour les échanges entre étapes du pipeline,
pour les corrélations cross-account,
et pour les références utilisées dans les diagnostics.

Les champs décomposés suivants sont extraits de l'ARN
et exposés en lecture pour les besoins de requête,
de filtrage,
de tri,
et d'affichage :

- `account_id`
- `region`
- `service`
- `resource_type`
- `resource_id`

Ces champs décomposés sont dérivés.

Ils ne remplacent pas l'identifiant fondamental.

La clé logique d'une ressource reste l'ARN.

Lorsque l'API source retourne déjà l'ARN,
Stronghold le consomme tel quel.

Lorsque l'API source ne retourne pas explicitement l'ARN mais fournit les éléments nécessaires,
le scanner responsable doit dériver l'ARN officiel avant l'entrée dans le coeur.

Le coeur ne crée pas une seconde identité de secours.

Exemples d'identités canoniques :

```text
arn:aws:ec2:eu-west-1:111122223333:instance/i-0123456789abcdef0
arn:aws:rds:eu-west-1:444455556666:db:payments-primary
arn:aws:kms:eu-west-1:777788889999:key/12345678-1234-1234-1234-123456789abc
arn:aws:route53:::hostedzone/Z0123456789ABCDEFG
```

#### Justification

L'ARN est l'identifiant canonique natif d'AWS.

Il est déjà utilisé par :

- IAM,
- CloudTrail,
- de nombreuses APIs AWS,
- les consoles de diagnostic,
- les runbooks d'exploitation,
- et les échanges humains entre opérateurs.

Choisir l'ARN comme identité primaire évite de maintenir une couche de traduction
entre une identité Stronghold inventée
et l'identité réellement utilisée partout ailleurs.

Cette décision est particulièrement importante en multi-account,
car l'unicité n'est plus locale à un compte.

Deux ressources de même type,
portant un identifiant métier proche,
peuvent exister dans plusieurs comptes
et plusieurs régions.

L'ARN capture directement ces dimensions.

La décomposition en `account_id`,
`region`,
`service`,
`resource_type`,
et `resource_id`
reste utile,
mais elle doit être vue comme une projection pratique,
pas comme la source de vérité.

Le fait de garder l'ARN comme clé primaire améliore aussi la debuggabilité.

Lorsqu'un opérateur lit un finding,
un noeud de graphe,
ou une erreur de scan,
il peut immédiatement recouper l'objet avec AWS sans table de correspondance.

Enfin,
le choix `ARN everywhere` simplifie les blocs suivants.

L'orchestration multi-account,
la détection de dépendances cross-account,
et les futurs contrats de données héritent d'une identité stable
dès la base du modèle.

#### Conséquences

Conséquences positives :

- unicité globale naturelle sur le périmètre AWS supporté,
- bonne corrélation avec les outils externes,
- suppression d'une classe entière de mappings internes,
- simplicité de debug pour les SRE et les équipes sécurité,
- facilité accrue pour détecter les endpoints cross-account.

Conséquences de modélisation :

- les structures `Resource`,
  `Finding`,
  `Evidence`,
  et `NodeReference`
  devront converger vers l'ARN comme identifiant principal,
- les champs décomposés seront calculés ou persistés comme vues dérivées,
- les API internes devront interdire les clés composites concurrentes.

Conséquences opérationnelles :

- la qualité du parsing ARN devient un point critique,
- les scanners devront être homogènes dans la manière de fournir l'ARN,
- les exceptions de services AWS atypiques devront être gérées à la source,
  pas par un contournement dans le coeur.

Conséquences négatives acceptées :

- les chaînes ARN sont plus longues qu'un identifiant opaque,
- elles augmentent légèrement la taille mémoire du graphe et des snapshots,
- elles imposent une discipline stricte sur la normalisation.

Ces coûts sont jugés acceptables
par rapport au gain de lisibilité et de cohérence.

#### Alternatives rejetées

Alternative rejetée 1 :
tuple composite
`(account_id, region, service, resource_type, resource_id)`.

Motif du rejet :

- plus verbeux dans tout le code,
- besoin d'une sérialisation custom,
- risque de divergences entre variantes de tuple,
- debug moins direct qu'un ARN complet.

Alternative rejetée 2 :
hash opaque.

Motif du rejet :

- perte immédiate de debuggabilité,
- nécessité d'un index inverse pour toute investigation,
- faible valeur ajoutée face à une identité AWS déjà canonique.

Alternative rejetée 3 :
identifiant local par scanner,
avec conversion en ARN plus tard.

Motif du rejet :

- repousse le problème sans le résoudre,
- crée des frontières d'identité instables dans le pipeline,
- complique les joints cross-account,
- augmente le risque d'erreurs lors du merge des résultats.

### D2 — Node ID dans le graphe

#### Décision

L'identifiant du noeud graphology est exactement l'ARN de la ressource.

La règle normative est :

`node.id = resource.arn`

Aucun préfixe n'est ajouté.

Aucune transformation n'est appliquée.

Aucune version encodée,
hachée,
ou raccourcie
n'est introduite.

Le graphe n'entretient donc pas une identité distincte de celle du modèle ressource.

Le même ARN sert à :

- indexer les noeuds,
- créer les arêtes,
- relier les findings à un noeud,
- identifier les endpoints cross-account,
- exporter le graphe,
- et relire un noeud dans un diagnostic.

Exemple :

```text
resource.arn = arn:aws:ec2:eu-west-1:111122223333:instance/i-0123456789abcdef0
graph node id = arn:aws:ec2:eu-west-1:111122223333:instance/i-0123456789abcdef0
```

#### Justification

Le graphe est un miroir structurel du modèle de ressources.

Lui attribuer un autre schéma d'identité ne créerait aucune valeur,
mais ajouterait une couche de complexité.

En multi-account,
le besoin principal est l'unicité transversale.

L'ARN fournit déjà cette propriété.

Le conserver comme node id supprime tout besoin de table de traduction
entre `identité graphe` et `identité ressource`.

Cette décision facilite aussi le debug.

Quand une arête paraît incorrecte,
le node id est immédiatement lisible
et exploitable dans AWS.

Elle facilite enfin les diff,
les exports HTML,
les snapshots,
et les logs techniques,
car tous parlent la même langue identitaire.

Le coût principal est la longueur des clés.

Ce coût est assumé.

Il est inférieur au coût d'une abstraction supplémentaire.

#### Conséquences

Conséquences positives :

- unicité garantie sans convention supplémentaire,
- suppression des fonctions de mapping réversible,
- simplification des patches et des exports de graphe,
- meilleure interprétabilité des arêtes cross-account,
- réduction du risque d'erreurs dans la reconstruction d'un graphe.

Conséquences sur le pipeline :

- toute étape qui manipule un node id doit accepter un ARN complet,
- les clés de dictionnaires et d'index dérivent directement de l'ARN,
- les edges cross-account n'ont pas besoin d'un espace de noms spécial.

Conséquences sur l'outillage :

- les rendus et exports doivent être capables d'afficher un label humain séparément du node id,
- les messages utilisateurs peuvent continuer à privilégier des noms courts,
  mais les références techniques restent basées sur l'ARN,
- les éventuels raccourcis d'affichage ne doivent jamais être réutilisés comme clé logique.

Conséquences négatives acceptées :

- consommation mémoire légèrement supérieure,
- bruit visuel plus élevé si un affichage montre directement les ids,
- besoin de prudence sur les longueurs dans certains formats export.

Ces inconvénients sont considérés comme secondaires
et relèvent principalement de l'affichage,
pas de la modélisation.

#### Alternatives rejetées

Alternative rejetée 1 :
préfixer l'ARN par le type de noeud,
par exemple `aws:<arn>`.

Motif du rejet :

- redondance,
- aucun gain d'unicité,
- augmentation artificielle de la longueur,
- nouvelle convention à maintenir.

Alternative rejetée 2 :
utiliser un identifiant court interne
et stocker l'ARN comme attribut.

Motif du rejet :

- perte de lisibilité,
- besoin d'une correspondance bidirectionnelle,
- complexification inutile du debug et des exports.

Alternative rejetée 3 :
concaténer `account_id:resource_id`.

Motif du rejet :

- information régionale et service perdue ou déplacée,
- risque de collisions,
- schéma moins robuste que l'ARN natif.

### D3 — Stratégie d'authentification

#### Décision

Stronghold adopte une abstraction `AuthProvider`
portant trois stratégies implémentées :

- `ProfileAuthProvider`
- `AssumeRoleAuthProvider`
- `SSOAuthProvider`

L'ordre d'autodétection retenu est :

1. profil nommé explicite et résolvable,
2. AssumeRole avec Organization Role configuré,
3. session SSO active.

L'utilisateur peut forcer la stratégie via un flag CLI
ou via la configuration.

L'autodétection n'est donc qu'un comportement par défaut,
pas un mécanisme obligatoire.

Le choix de stratégie se fait avant la création du `ScanContext` du compte.

Le résultat de ce choix est un contexte de credentials propre au compte cible.

Cette décision ne présume pas l'usage d'AWS Organizations.

Elle couvre aussi les parcs non organisationnels,
dans lesquels un profil local ou une session SSO
est le mode d'accès principal.

#### Justification

Les environnements AWS de production sont hétérogènes.

Il serait irréaliste de supposer
qu'un seul mode d'authentification couvre proprement le terrain.

Le trio profile / AssumeRole / SSO couvre la très grande majorité des cas réels.

Les profils nommés restent fréquents dans les petites et moyennes structures,
dans les environnements de développement,
et dans les cas où un poste d'administration dispose déjà d'une configuration AWS CLI stable.

AssumeRole reste central dans les organisations structurées,
notamment quand un rôle commun de lecture existe sur plusieurs comptes.

SSO est désormais standard dans de nombreux environnements d'entreprise
où les identités sont fédérées
et où les sessions locales sont gérées par IAM Identity Center.

L'ordre d'autodétection choisi reflète une préférence pour l'explicite.

Un profil nommé demandé explicitement par l'utilisateur
doit gagner sur des heuristiques plus globales.

AssumeRole vient ensuite,
car il correspond au cas d'usage principal d'une organisation AWS administrée centralement.

SSO arrive en troisième position,
comme mode moderne compatible avec les postes déjà connectés.

Le forçage manuel reste indispensable.

Il évite les ambiguïtés,
les surprises d'autodétection,
et les cas où plusieurs mécanismes sont valides simultanément.

#### Conséquences

Conséquences positives :

- couverture large des environnements de production,
- réduction du besoin de contournements manuels,
- meilleure portabilité du CLI entre petites structures et grandes entreprises,
- compatibilité avec Organizations et hors Organizations,
- surface explicite pour documenter les erreurs d'authentification.

Conséquences d'architecture :

- l'authentification devient un port clair plutôt qu'une logique ad hoc dispersée,
- les providers doivent exposer un contrat homogène de résolution des credentials,
- les messages d'erreur doivent conserver la stratégie choisie,
  le compte visé,
  et l'étape d'échec.

Conséquences de produit :

- la documentation utilisateur devra expliquer les trois stratégies,
- la configuration devra pouvoir exprimer un forçage par compte ou global,
- les futures évolutions devront enrichir le port `AuthProvider`
  sans le coupler à un framework ou à un storage particulier.

Conséquences négatives acceptées :

- plus de code à maintenir qu'une seule stratégie hardcodée,
- davantage de cas de tests,
- nécessité de clarifier les règles de priorité quand plusieurs stratégies sont disponibles,
- risque accru d'erreurs de configuration si le mode n'est pas explicite.

Ces coûts sont jugés acceptables,
car ils correspondent à la complexité réelle des environnements ciblés,
et non à une sophistication artificielle.

#### Alternatives rejetées

Alternative rejetée 1 :
AssumeRole only.

Motif du rejet :

- exclut les setups non-Organizations,
- pénalise les environnements plus simples,
- impose une gouvernance IAM homogène qui n'existe pas toujours.

Alternative rejetée 2 :
SSO only.

Motif du rejet :

- exclut les setups legacy,
- exclut certains workflows automatisés ou postes non fédérés,
- impose une dépendance d'usage qui n'est pas universelle.

Alternative rejetée 3 :
chaîne d'authentification implicite `whatever works`.

Motif du rejet :

- comportement difficile à expliquer,
- priorités ambiguës,
- risque élevé de surprise opérationnelle,
- moindre auditabilité de la source réelle des credentials.

### D4 — Credential Isolation

#### Décision

Chaque compte scanné possède son propre `ScanContext`.

Ce `ScanContext` porte au minimum :

- les credentials résolus pour le compte,
- l'identité du compte ciblé,
- la région ou l'ensemble des régions scannées pour ce compte,
- la fabrique de clients AWS associée,
- le rate limiter associé,
- et le contexte d'audit technique utile à ce compte.

Les credentials ne traversent jamais la frontière d'un `ScanContext`.

Cette règle est normative.

Un leak de credential d'un compte A vers le scan du compte B
est défini comme un bug critique.

La mutualisation de structures transverses n'est autorisée
que pour des données non sensibles et non exécutrices,
par exemple :

- des ressources normalisées déjà découvertes,
- des findings,
- des métadonnées de compte non sensibles,
- des arêtes candidates,
- des erreurs structurées.

Les clients AWS,
les providers de credentials,
les tokens temporaires,
et les caches associés
restent confinés au `ScanContext`.

#### Justification

L'isolation des credentials est une exigence de sécurité de base.

Le fait d'exécuter plusieurs scans dans un même processus
ne doit pas brouiller les frontières de confiance.

Dans un modèle multi-account,
l'erreur la plus dangereuse n'est pas seulement l'échec d'authentification.

C'est l'utilisation silencieuse d'un mauvais credential sur un mauvais compte.

Ce type d'erreur produit :

- des résultats faux,
- des diagnostics difficiles,
- et potentiellement un contournement involontaire des attentes de moindre privilège.

Formaliser le `ScanContext` comme frontière explicite
réduit ce risque.

Cette décision améliore aussi la maintenabilité.

Les scanners peuvent raisonner sur un contexte local clair,
sans dépendre d'un singleton global de credentials.

Enfin,
elle prépare naturellement la concurrence inter-comptes.

Des comptes scannés en parallèle
doivent rester isolés même si leur cycle de vie se chevauche.

#### Conséquences

Conséquences positives :

- réduction forte du risque de contamination inter-comptes,
- meilleur alignement avec le principe de moindre privilège,
- architecture compatible avec le parallélisme,
- auditabilité améliorée des erreurs et des appels AWS,
- meilleure lisibilité pour les revues sécurité.

Conséquences d'implémentation :

- les scanners devront recevoir un contexte par compte,
- les factories de clients AWS deviendront contextuelles,
- toute forme de cache devra être keyée au moins par compte,
  et idéalement confinée au `ScanContext`,
- les étapes du pipeline qui agrègent les résultats ne manipuleront plus de credentials.

Conséquences sur les tests :

- les tests devront vérifier l'absence de fuite entre contexts,
- les mocks d'AWS devront être capables de distinguer plusieurs comptes simultanés,
- les tests de concurrence devront couvrir les mélanges de résultats et d'erreurs.

Conséquences négatives acceptées :

- création d'un plus grand nombre d'objets contextuels,
- davantage de plumbing explicite dans l'orchestrateur,
- moins d'opportunités de mutualiser des clients AWS réutilisables globalement.

Ces coûts sont secondaires
au regard de la sécurité et de la correction fonctionnelle.

#### Alternatives rejetées

Alternative rejetée 1 :
credential pool partagé.

Motif du rejet :

- risque de fuite inter-comptes,
- difficulté à prouver l'isolation,
- ambiguïté sur la propriété d'un client ou d'un token.

Alternative rejetée 2 :
singleton global de provider AWS.

Motif du rejet :

- modèle incompatible avec le parallélisme sain,
- forte opacité en debug,
- couplage excessif entre comptes.

Alternative rejetée 3 :
ré-authentifier systématiquement chaque appel scanner.

Motif du rejet :

- coût API inutile,
- augmentation de la latence,
- bruit supplémentaire dans les logs et les points de panne,
- absence de bénéfice supérieur à un contexte bien isolé.

### D5 — Credential Refresh

#### Décision

Les credentials temporaires obtenus via AssumeRole ou SSO
sont considérés comme expirants par nature.

Le `ScanContext` doit détecter une expiration imminente
lorsque l'échéance est inférieure à 5 minutes.

Dans ce cas,
il déclenche un refresh automatique.

Le refresh est transparent pour les scanners.

Les scanners ne gèrent pas eux-mêmes la politique de renouvellement.

Ils s'appuient sur le `ScanContext`
ou sur le provider de credentials encapsulé par celui-ci.

La logique de refresh doit intégrer une tolérance au clock skew raisonnable.

Elle doit également rester spécifique au compte
et à la stratégie d'authentification en cours.

Les credentials statiques ou suffisamment durables
ne sont pas rafraîchis artificiellement.

#### Justification

Le temps d'exécution d'un scan multi-account
peut dépasser une heure sur des environnements volumineux,
des régions multiples,
ou des postes soumis à des délais d'API élevés.

Faire dépendre la réussite d'un scan long
de la durée nominale initiale du token
serait fragile.

Un échec en fin de scan pour cause d'expiration
est particulièrement coûteux,
car il intervient après que la commande a déjà consommé du temps
et potentiellement produit des résultats partiels.

Le refresh transparent améliore donc la robustesse
sans déporter la complexité vers les scanners.

Le seuil de 5 minutes répond à un compromis simple :

- suffisamment tôt pour éviter les expirations en vol,
- suffisamment tard pour ne pas rafraîchir agressivement les scans courts,
- compatible avec une logique de réutilisation raisonnable des credentials.

Cette décision traite la durée de vie des tokens
comme une propriété de l'infrastructure d'exécution,
pas comme une responsabilité métier des scanners.

#### Conséquences

Conséquences positives :

- robustesse accrue sur grandes infrastructures,
- réduction des échecs tardifs et difficiles à diagnostiquer,
- transparence pour les scanners,
- politique cohérente entre AssumeRole et SSO,
- meilleure expérience opérateur sur scans longs.

Conséquences techniques :

- le `ScanContext` doit connaître l'échéance des credentials,
- les providers doivent exposer ou encapsuler cette information,
- les clients AWS créés via le contexte doivent rester compatibles avec un refresh en cours de vie,
- la gestion des erreurs de refresh doit remonter comme échec d'auth spécifique au compte.

Conséquences de sécurité :

- aucun refresh ne doit basculer vers un autre compte,
- le refresh doit réutiliser la même stratégie et la même cible,
- les logs ne doivent jamais exposer les tokens eux-mêmes.

Conséquences négatives acceptées :

- logique supplémentaire dans le contexte d'exécution,
- cas de tests plus nombreux,
- nécessité d'observer et tracer proprement les erreurs de renouvellement,
- légère complexité accrue dans les factories de clients AWS.

Ces coûts sont jugés nécessaires
pour éviter une fragilité structurelle sur scans longs.

#### Alternatives rejetées

Alternative rejetée 1 :
échouer à l'expiration.

Motif du rejet :

- inacceptable pour un scan potentiellement long,
- mauvaise expérience opérateur,
- faible résilience sur les grands parcs.

Alternative rejetée 2 :
ré-authentifier systématiquement toutes les 30 minutes.

Motif du rejet :

- inutile pour les scans courts,
- surcharge API et complexité sans justification,
- politique arbitraire moins précise qu'un seuil sur l'expiration réelle.

Alternative rejetée 3 :
laisser chaque scanner gérer son refresh.

Motif du rejet :

- duplication de logique,
- incohérences probables entre scanners,
- violation du principe de séparation des responsabilités.

### D6 — Partial Failure Handling

#### Décision

Si l'authentification ou le scan d'un compte échoue,
les autres comptes continuent.

Le scan global ne devient pas automatiquement un échec total.

Le rapport final doit contenir une section `ScanErrors`
qui détaille,
pour chaque compte en échec :

- `account_id`
- `phase`
- `message`
- `impact`

La `phase` doit au minimum distinguer :

- `auth`
- `scanner`
- `processing`

Le `message` conserve le message d'erreur original,
éventuellement enrichi d'un contexte technique non sensible.

L'`impact` doit permettre de comprendre
si l'échec invalide des ressources,
des findings,
ou des dépendances cross-account potentielles.

Les edges dont un endpoint appartient à un compte en échec
sont marqués `incomplete`
et non `absent`.

Cette sémantique est obligatoire.

Exemple de forme cible :

```json
{
  "scanErrors": [
    {
      "account_id": "444455556666",
      "phase": "auth",
      "message": "AccessDenied: not authorized to assume role",
      "impact": "Cross-account edges targeting this account are incomplete"
    }
  ]
}
```

#### Justification

Dans un environnement multi-account réel,
l'échec partiel est normal,
pas exceptionnel.

Un compte peut être temporairement inaccessible
pour des raisons multiples :

- rôle manquant,
- SCP bloquante,
- permissions insuffisantes,
- session expirée,
- région désactivée,
- ou simple erreur de configuration locale.

Faire échouer la commande entière
parce qu'un sous-périmètre est indisponible
détruirait l'utilité du produit sur les grands environnements.

À l'inverse,
ignorer silencieusement le compte en erreur
serait inacceptable pour un outil DR.

Le système doit donc produire deux choses à la fois :

- le maximum de résultat fiable sur le périmètre accessible,
- et une expression explicite de l'incertitude restante.

La distinction entre `incomplete` et `absent`
est centrale.

En DR,
une absence observée
et une absence non vérifiée
ne portent pas le même sens.

Le rapport doit préserver cette nuance,
sinon il induit des faux négatifs.

#### Conséquences

Conséquences positives :

- meilleure résilience opérationnelle,
- valeur partielle conservée en environnement imparfait,
- honnêteté accrue du rapport,
- compatibilité avec des scans large échelle où certains comptes fluctuent,
- meilleure base pour l'automatisation CI et les investigations manuelles.

Conséquences de modélisation :

- le pipeline doit transporter des erreurs structurées par compte,
- le modèle d'arête doit supporter un état `incomplete`,
- le reporting doit distinguer clairement l'inconnu de l'absence,
- les futurs contrats d'API devront préserver cette nuance.

Conséquences sur le scoring et l'analyse :

- le système ne doit pas conclure à l'absence d'une dépendance non observée dans un compte failed,
- certaines validations pourront devoir refléter l'incertitude plutôt qu'un échec binaire,
- le rapport devra exposer les zones où la confiance est dégradée par échec de scan.

Conséquences négatives acceptées :

- rapport final plus complexe,
- besoin d'une sémantique d'erreur stable,
- complexité accrue sur les edges cross-account,
- nécessité d'une documentation claire pour éviter la confusion entre `non trouvé` et `non vérifié`.

Ces coûts sont jugés nécessaires,
car l'alternative serait soit trompeuse,
soit inutilisable.

#### Alternatives rejetées

Alternative rejetée 1 :
fail-fast global.

Motif du rejet :

- inutilisable sur de grands environnements,
- valeur nulle si un seul compte échoue,
- trop fragile pour un outil de posture DR.

Alternative rejetée 2 :
silent failure.

Motif du rejet :

- inacceptable pour un outil d'analyse de risque,
- crée des faux sentiments de couverture,
- empêche toute décision informée par l'opérateur.

Alternative rejetée 3 :
continuer sans état d'incertitude explicite.

Motif du rejet :

- confond inconnu et absent,
- casse la confiance dans les résultats,
- rend les dépendances cross-account imprécises.

### D7 — Scan Concurrency

#### Décision

Les comptes sont scannés en parallèle
avec une concurrence configurable.

La valeur par défaut est `3`.

À l'intérieur de chaque compte,
les scanners conservent leur modèle de concurrence existant.

Il n'existe pas de file globale partagée entre tous les comptes.

Chaque `ScanContext` possède son propre rate limiter AWS
et sa propre enveloppe d'exécution.

La concurrence inter-comptes
et la concurrence intra-compte
sont donc deux niveaux distincts.

Cette décision n'autorise pas un partage implicite de clients ou de limites
entre contexts.

Elle vise une parallélisation raisonnable,
pas un "full blast" opportuniste.

#### Justification

Le scan séquentiel de plusieurs comptes
devient rapidement trop lent.

À l'inverse,
le parallélisme maximal sur tous les comptes à la fois
augmente fortement le risque de throttling,
de bruit dans les logs,
et de contention sur les credentials ou les clients.

Une concurrence par défaut à 3 constitue un compromis praticable.

Elle apporte un gain net de temps
sans supposer que l'environnement supporte un fan-out massif.

Le maintien de la concurrence existante à l'intérieur d'un compte
évite de réécrire inutilement la logique locale déjà maîtrisée.

La séparation des rate limiters par `ScanContext`
renforce l'isolation :

- elle évite qu'un compte bruyant pénalise tous les autres,
- elle rend les comportements plus lisibles,
- elle simplifie l'attribution d'un throttling à un compte précis.

Cette stratégie prépare aussi des réglages ultérieurs.

Le produit pourra ajuster la concurrence globale
sans remettre en cause l'architecture identitaire et d'authentification.

#### Conséquences

Conséquences positives :

- amélioration raisonnable des temps de scan,
- réduction du risque de throttling systémique,
- isolation préservée entre comptes,
- conservation des mécanismes locaux déjà existants dans les scanners,
- meilleure possibilité de tuning par l'opérateur.

Conséquences d'implémentation :

- l'orchestrateur devra piloter un fan-out borné par compte,
- les logs devront être taggés par `account_id`,
- les métriques de temps devront être lisibles à deux niveaux :
  compte et scan global,
- les erreurs de throttling devront rester attribuables à un contexte précis.

Conséquences sur la stabilité :

- la mémoire consommée augmente avec le nombre de comptes traités en parallèle,
- des scans très larges demanderont une configuration réfléchie,
- le comportement devra être documenté pour les opérateurs qui scannent plusieurs dizaines de comptes.

Conséquences négatives acceptées :

- complexité supérieure au séquentiel,
- bruit log potentiellement plus élevé,
- nécessité d'un scheduler borné dans l'orchestrateur,
- résultat final dépendant davantage de la qualité du tagging contextuel.

Ces coûts restent inférieurs
au coût d'un scan multi-account trop lent pour être utile.

#### Alternatives rejetées

Alternative rejetée 1 :
séquentiel pur.

Motif du rejet :

- trop lent dès quelques comptes,
- dégrade fortement l'expérience opérateur,
- augmente le risque d'expiration des credentials sur scans longs.

Alternative rejetée 2 :
full parallel.

Motif du rejet :

- throttling probable au-delà de quelques comptes,
- pression accrue sur les endpoints AWS,
- forte variabilité de comportement selon les environnements.

Alternative rejetée 3 :
file globale unique avec rate limiter partagé.

Motif du rejet :

- affaiblit l'isolation par compte,
- brouille l'origine d'un throttling,
- rend l'architecture moins lisible qu'un limiter par `ScanContext`.

### D8 — Aggregated Report by Default

#### Décision

Le rapport par défaut du mode multi-account est un rapport unifié.

Tous les comptes scannés y sont combinés.

Chaque finding,
chaque noeud,
et chaque élément de contexte pertinent
reste taggé par `account_id`.

La vue agrégée est donc unifiée
sans faire disparaître l'origine de chaque donnée.

Un mode `--per-account-report`
sera livré plus tard,
hors Phase 1,
pour fournir une vue d'isolation stricte par compte.

Ce mode futur n'est pas la sortie par défaut.

La sortie par défaut doit privilégier la visibilité des dépendances et risques cross-account.

Cette décision vaut pour la restitution générale du scan,
pas pour l'isolation des credentials,
qui reste stricte.

#### Justification

La valeur différenciante de Stronghold en multi-account
est de révéler la posture DR réelle d'un système distribué sur plusieurs comptes.

Cette posture n'est pas la somme de rapports mono-compte juxtaposés.

Une dépendance cross-account critique
peut rester invisible
si l'utilisateur doit mentalement recoller plusieurs sorties séparées.

Le rapport unifié rend visibles,
dès la lecture par défaut :

- les dépendances entre comptes,
- les single points of failure transverses,
- les ressources partagées,
- et les findings qui portent sur des chaînes multi-account.

Le tagging par `account_id`
préserve malgré tout l'attribution,
ce qui évite de perdre le contexte opératoire.

Le mode `--per-account-report` est utile,
mais il répond à un besoin de vue alternative,
pas à la proposition de valeur principale du bloc Phase 1.

Le rendre obligatoire,
ou le choisir à chaque scan,
augmenterait la friction
sans améliorer la qualité du modèle.

#### Conséquences

Conséquences positives :

- vue DR réellement alignée sur l'architecture de production,
- meilleure visibilité des risques cross-account,
- rapport plus utile pour les revues d'architecture,
- base cohérente pour le scoring et les recommandations unifiés,
- réduction du travail mental de reconstitution par l'utilisateur.

Conséquences de restitution :

- les écrans,
  exports,
  ou sections CLI
  devront afficher clairement `account_id`,
- les services,
  findings,
  et ressources
  devront pouvoir être filtrés par compte sans changer de modèle,
- la documentation devra expliquer la différence entre agrégation logique et isolation de sécurité.

Conséquences de produit :

- le mode multi-account assume une lecture transverse par défaut,
- certaines équipes demanderont rapidement une vue stricte par compte,
  mais cette demande est différée explicitement hors Phase 1,
- les futures API devront conserver des tags suffisants pour reconstruire une vue mono-compte si besoin.

Conséquences négatives acceptées :

- rapport plus dense,
- nécessité d'un design d'affichage clair pour éviter la confusion,
- risque initial d'attente différente chez des utilisateurs habitués à une lecture par compte,
- besoin de filtres ou regroupements ergonomiques dans les surfaces futures.

Ces coûts sont acceptés,
car ils découlent directement de la valeur recherchée.

#### Alternatives rejetées

Alternative rejetée 1 :
rapport per-account par défaut.

Motif du rejet :

- perd le différenciateur principal du multi-account,
- rend les dépendances transverses moins visibles,
- force l'utilisateur à reconstituer lui-même la posture réelle.

Alternative rejetée 2 :
obliger l'utilisateur à choisir un mode à chaque scan.

Motif du rejet :

- friction UX inutile,
- absence de bénéfice architectural,
- ajoute une décision répétitive sans changer le modèle de fond.

Alternative rejetée 3 :
générer uniquement plusieurs rapports séparés.

Motif du rejet :

- incompatible avec une lecture unifiée des risques cross-account,
- complique les comparaisons et le suivi,
- limite la valeur du graphe global.

## 5. Consequences

### 5.1 Positives

Le premier bénéfice est un modèle d'identité robuste et déboguable.

L'usage systématique de l'ARN
supprime les ambiguïtés sur la référence d'une ressource.

Le deuxième bénéfice est une couverture d'authentification réaliste.

Le triptyque Profile / AssumeRole / SSO
couvre l'essentiel des environnements de production contemporains,
sans exclure les setups non organisationnels.

Le troisième bénéfice est la résilience aux pannes partielles.

Un scan multi-account reste utile
même lorsqu'une partie du périmètre est inaccessible.

Le quatrième bénéfice est la qualité de la sémantique d'incertitude.

Le système peut distinguer
ce qui a été observé absent
de ce qui n'a pas pu être observé.

Le cinquième bénéfice est la solidité de la base pour les blocs suivants.

Les blocs dédiés au refactor d'identité,
aux contrats,
à l'orchestration,
et à la détection de dépendances cross-account
partiront d'une décision déjà alignée.

Le sixième bénéfice est l'alignement sécurité.

L'isolation stricte des credentials par `ScanContext`
fournit un cadre clair
pour les revues RSSI et les audits internes.

### 5.2 Négatives

Le premier coût est un refactor significatif du code existant.

Les structures de ressource,
le graphe,
et certaines hypothèses du pipeline
devront être rendus explicitement account-aware.

Le deuxième coût est la maintenance de trois `AuthProvider`
au lieu d'une logique d'authentification plus simple et implicite.

Le troisième coût est la hausse de complexité des tests.

Les tests unitaires devront couvrir plusieurs stratégies d'auth,
plusieurs comptes,
et des scénarios d'échec partiel ou d'expiration.

Les vrais E2E demanderont un setup multi-account plus lourd.

Le quatrième coût est documentaire.

La documentation utilisateur devra expliquer :

- comment choisir une stratégie d'auth,
- comment la forcer,
- comment lire un rapport agrégé,
- et comment interpréter `incomplete`.

Le cinquième coût est ergonomique.

Un rapport unifié sera naturellement plus dense
qu'une sortie mono-compte.

Le produit devra compenser cette densité
par des filtres,
des tags,
et une présentation disciplinée.

### 5.3 Conséquences sur les invariants Stronghold

Invariant :
`scan is read-only`

État :
PRÉSERVÉ

Raison :
le multi-account n'ajoute aucun mécanisme de modification d'infrastructure.

Invariant :
`core no framework`

État :
PRÉSERVÉ

Raison :
`AuthProvider` reste une abstraction TypeScript pure.

L'orchestration CLI ou server peut l'utiliser,
mais le coeur n'introduit pas de dépendance framework.

Invariant :
`RTO/RPO null-safe`

État :
PRÉSERVÉ

Raison :
le multi-account ne justifie aucune estimation fictive.

Les valeurs non vérifiées restent `null`.

Invariant :
`scoring severity ceiling`

État :
PRÉSERVÉ

Raison :
le scoring peut agréger des findings multi-account
sans changer la règle de plafond par sévérité.

Invariant :
`principle of least privilege`

État :
RENFORCÉ

Raison :
l'isolation par `ScanContext`
rend explicite le périmètre de credentials de chaque compte.

Invariant :
`auditability of scan behavior`

État :
RENFORCÉ

Raison :
la stratégie d'auth,
les échecs par compte,
et les zones `incomplete`
deviennent explicitement modélisés.

## 6. Rollout Plan

### 6.1 Bloc 2 — Account-aware Resource/Node identity refactor

Ce bloc livrera l'alignement des structures de ressources
et des identités de noeuds sur le modèle `ARN as primary key`.

Il couvrira notamment :

- l'unification de l'identité ressource,
- l'extraction systématique des champs dérivés,
- l'alignement des ids de graphe,
- et l'élimination des hypothèses mono-compte dans les structures visées.

Sortie attendue :

un coeur capable de manipuler plusieurs comptes
sans collision d'identité ni double convention de clé.

### 6.2 Bloc 3 — AuthProvider strategy pattern

Ce bloc livrera le port d'authentification
et ses trois implémentations :

- Profile
- AssumeRole
- SSO

Il couvrira :

- le contrat `AuthProvider`,
- l'autodétection avec ordre de priorité,
- le forçage par CLI ou config,
- et la préparation du refresh transparent.

Sortie attendue :

une base d'authentification factorisée,
testable,
et compatible multi-account.

### 6.3 Bloc 4 — Multi-account scan orchestration

Ce bloc livrera l'orchestrateur de scan inter-comptes.

Il couvrira :

- la création d'un `ScanContext` par compte,
- la concurrence bornée par défaut à 3,
- la collecte des résultats par compte,
- la structuration des `ScanErrors`,
- et la poursuite du scan en cas d'échec partiel.

Sortie attendue :

une commande capable de scanner plusieurs comptes dans une même exécution,
avec isolation des contexts et résultat agrégé.

### 6.4 Bloc 5 — Cross-account dependency detection

Ce bloc livrera la détection et la représentation
des dépendances transverses minimales ciblées en Phase 1.

Il couvrira :

- VPC peering,
- KMS cross-account grants,
- IAM AssumeRole chains,
- Transit Gateway attachments,
- Route53 shared zones,
- et la sémantique `incomplete` pour les edges touchés par un compte failed.

Sortie attendue :

un graphe capable d'exprimer la topologie réelle au-delà des frontières de compte.

### 6.5 Bloc 6 — Validation sur vraie infra multi-account

Ce bloc livrera la validation sur infrastructure réelle.

Il couvrira :

- des scénarios de scan multi-account opérationnels,
- la vérification des trois stratégies d'authentification,
- la validation de l'isolation des credentials,
- la validation de la partial failure,
- et la vérification des dépendances cross-account principales.

Sortie attendue :

une preuve pratique que le modèle décidé ici tient en conditions réelles,
pas seulement en tests unitaires.

## 7. References

Les ressources externes suivantes ont été consultées
pour cadrer cet ADR :

1. AWS STS / IAM documentation on temporary credentials and role assumption best practices.
   https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html

2. AWS Organizations documentation on service control policies.
   https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html

3. AWS CLI / IAM Identity Center documentation on SSO configuration and login flows.
   https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html

4. Michael Nygard ADR format reference.
   https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions

Consultation date :
2026-04-16

Ces références servent de contexte externe.

Les décisions de cet ADR restent spécifiques à Stronghold,
à ses invariants,
et au périmètre de la Phase 1.
