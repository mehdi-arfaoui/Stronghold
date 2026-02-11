export interface KnowledgeBaseArticle {
  id: string;
  slug: string;
  title: string;
  category: 'BIA' | 'PRA' | 'PCA' | 'resilience-metrics' | 'governance' | 'regulation' | 'architecture' | 'testing';
  tags: string[];
  summary: string;
  content: string;
  relatedTerms: string[];
  source: string;
  icon?: string;
}

export const KNOWLEDGE_BASE_ARTICLES: KnowledgeBaseArticle[] = [
  // ── BIA ──────────────────────────────────────────────────────────────
  {
    id: 'kb-bia-definition',
    slug: 'quest-ce-quun-bia',
    title: "Qu'est-ce qu'un BIA ?",
    category: 'BIA',
    tags: ['BIA', 'ISO22301', 'analyse-impact', 'RTO', 'RPO', 'MTPD'],
    summary: "Le BIA identifie les activites critiques, leurs impacts metier et les objectifs de reprise.",
    content: `## Definition
Le **Business Impact Analysis (BIA)** est une analyse structuree qui identifie les processus critiques et quantifie les impacts d'une interruption.

## Objectifs
- Prioriser les services critiques
- Determiner les tolerances d'interruption
- Fixer des objectifs de reprise (RTO, RPO, MTPD)

## Metriques
- **RTO**: delai maximal pour restaurer le service
- **RPO**: perte de donnees acceptable
- **MTPD**: duree maximale de perturbation tolerable

## Etapes
1. Inventorier les processus
2. Evaluer impacts financiers, operationnels, reputations
3. Definir criticite et priorites
4. Valider les objectifs de reprise`,
    relatedTerms: ['RTO', 'RPO', 'MTPD', 'criticite'],
    source: 'ISO 22301 §8.2.2',
  },
  {
    id: 'kb-bia-methodology',
    slug: 'methodologie-bia',
    title: 'Methodologie BIA pas a pas',
    category: 'BIA',
    tags: ['BIA', 'methodologie', 'processus', 'impact'],
    summary: 'Guide methodologique pour conduire un BIA complet en 6 etapes.',
    content: `## Etape 1 — Perimetre et preparation
- Definir le perimetre des processus couverts
- Identifier les parties prenantes (metier, IT, direction)
- Planifier les entretiens et ateliers

## Etape 2 — Identification des processus metier
- Cartographier les processus critiques
- Documenter les dependances entre processus
- Identifier les ressources cles (humaines, IT, logistiques)

## Etape 3 — Analyse des impacts
- **Impact financier** : pertes de revenus, penalites contractuelles
- **Impact operationnel** : degradation du service, retards
- **Impact reputationnel** : perte de confiance, image de marque
- **Impact reglementaire** : non-conformite, sanctions

## Etape 4 — Determination des seuils de tolerance
- Fixer le **MTPD** pour chaque processus
- Definir le **RTO** cible (toujours ≤ MTPD)
- Definir le **RPO** selon la criticite des donnees

## Etape 5 — Priorisation et tiers de reprise
- Classer les processus en tiers (Tier 1, 2, 3, 4)
- Tier 1 : reprise immediate (< 1h)
- Tier 2 : reprise rapide (1-4h)
- Tier 3 : reprise standard (4-24h)
- Tier 4 : reprise differee (> 24h)

## Etape 6 — Validation et revue
- Presenter les resultats aux responsables metier
- Valider les objectifs de reprise
- Documenter et archiver le BIA
- Planifier la revue periodique (annuelle minimum)`,
    relatedTerms: ['BIA', 'MTPD', 'RTO', 'RPO', 'tier'],
    source: 'ISO 22301 §8.2.2 / BCI Good Practice Guidelines',
  },
  {
    id: 'kb-bia-financial-impact',
    slug: 'impact-financier-bia',
    title: "Evaluer l'impact financier dans un BIA",
    category: 'BIA',
    tags: ['BIA', 'impact-financier', 'cout', 'analyse-impact'],
    summary: "Methodes de calcul et indicateurs pour quantifier l'impact financier d'une interruption.",
    content: `## Pourquoi quantifier ?
L'evaluation financiere permet de justifier les investissements en resilience et de prioriser les processus.

## Composantes du cout d'interruption
- **Perte de chiffre d'affaires** : revenu horaire x duree d'arret
- **Couts operationnels** : heures supplementaires, sous-traitance d'urgence
- **Penalites contractuelles** : SLA non respectes, amendes
- **Couts de reprise** : restauration, verification d'integrite
- **Perte de productivite** : employes idles, retards en chaine

## Formule simplifiee
Impact = (Revenu horaire + Cout operationnel horaire) x Duree d'arret + Couts fixes de reprise

## Echelle d'impact recommandee
| Niveau | Impact par heure |
|--------|-----------------|
| Critique | > 100 000 EUR |
| Eleve | 10 000 - 100 000 EUR |
| Moyen | 1 000 - 10 000 EUR |
| Faible | < 1 000 EUR |

## Conseils pratiques
- Impliquer la direction financiere dans l'evaluation
- Utiliser des donnees historiques si disponibles
- Ne pas oublier les couts indirects (reputation, opportunites perdues)`,
    relatedTerms: ['BIA', 'impact', 'cout', 'SLA'],
    source: 'BCI Good Practice Guidelines §4',
  },

  // ── Metriques de resilience ──────────────────────────────────────────
  {
    id: 'kb-rto-explained',
    slug: 'rto-explique',
    title: 'RTO — Recovery Time Objective',
    category: 'resilience-metrics',
    tags: ['RTO', 'BIA', 'PRA', 'MTPD', 'RPO'],
    summary: 'Le RTO est le temps maximal acceptable pour remettre un service en etat operationnel.',
    content: `## Definition
Le **Recovery Time Objective (RTO)** represente le temps cible maximal de restauration d'un service apres incident.

## Comment le determiner
- Evaluer l'impact metier par heure d'arret
- Prendre en compte obligations reglementaires
- Aligner capacites techniques et SLA

## Exemples
- Paiement en ligne: RTO 15-30 min
- ERP: RTO 2-4 h
- Intranet documentaire: RTO 8-24 h

## Relation avec RPO et MTPD
- RTO doit rester <= MTPD
- RPO influence le mode de reprise et les technologies de replication`,
    relatedTerms: ['RPO', 'MTPD', 'SLA', 'failover'],
    source: 'ISO 22301 §8.4.1',
  },
  {
    id: 'kb-rpo-explained',
    slug: 'rpo-explique',
    title: 'RPO — Recovery Point Objective',
    category: 'resilience-metrics',
    tags: ['RPO', 'backup', 'replication', 'PRA'],
    summary: "Le RPO mesure la quantite maximale de donnees que l'organisation accepte de perdre.",
    content: `## Definition
Le **Recovery Point Objective (RPO)** definit la perte de donnees maximale tolerable exprimee en temps.

## Impact architectural
- RPO proche de 0: replication synchrone / active-active
- RPO de quelques minutes: replication asynchrone frequente
- RPO de plusieurs heures: sauvegardes periodiques

## Decision pratique
Choisir un RPO doit equilibrer cout, complexite et criticite metier.`,
    relatedTerms: ['RTO', 'replication', 'backup', 'journalisation'],
    source: 'NIST SP 800-34 §3.4.2',
  },
  {
    id: 'kb-mtpd-explained',
    slug: 'mtpd-explique',
    title: 'MTPD — Maximum Tolerable Period of Disruption',
    category: 'resilience-metrics',
    tags: ['MTPD', 'RTO', 'BIA'],
    summary: "Le MTPD est la duree maximale pendant laquelle un processus peut etre interrompu sans dommage inacceptable.",
    content: `## Definition
Le **Maximum Tolerable Period of Disruption (MTPD)** est la limite absolue d'interruption acceptable pour un processus.

## Difference avec le RTO
- **MTPD**: seuil de rupture metier
- **RTO**: objectif technique pour restaurer avant ce seuil

## Evaluation
- Identifier le point de non-retour metier
- Quantifier impacts cumules (financiers, juridiques, image)
- Valider avec les responsables metier`,
    relatedTerms: ['RTO', 'BIA', 'continuité'],
    source: 'ISO 22301 §8.2.2',
  },
  {
    id: 'kb-mbco',
    slug: 'mbco-explique',
    title: 'MBCO — Minimum Business Continuity Objective',
    category: 'resilience-metrics',
    tags: ['MBCO', 'BIA', 'PCA', 'continuité'],
    summary: 'Le MBCO definit le niveau minimal de service acceptable pendant une perturbation.',
    content: `## Definition
Le **Minimum Business Continuity Objective (MBCO)** est le niveau de service minimum qu'une organisation doit maintenir pendant une crise pour eviter des dommages inacceptables.

## Difference avec le RTO
- **RTO** : quand le service sera retabli
- **MBCO** : a quel niveau minimal le service doit fonctionner pendant la crise

## Exemples
- Systeme de vente : traiter au moins 30% des commandes
- Support client : repondre aux urgences uniquement
- Production : maintenir une ligne sur trois

## Comment le definir
1. Identifier les fonctions essentielles de chaque processus
2. Determiner le seuil en-deca duquel l'activite est non viable
3. Valider avec les responsables metier et la direction
4. Documenter les ressources minimales necessaires`,
    relatedTerms: ['BIA', 'RTO', 'PCA', 'mode-degrade'],
    source: 'ISO 22301 §8.2.2',
  },
  {
    id: 'kb-wrt',
    slug: 'wrt-work-recovery-time',
    title: 'WRT — Work Recovery Time',
    category: 'resilience-metrics',
    tags: ['WRT', 'RTO', 'MTPD', 'reprise'],
    summary: 'Le WRT mesure le temps necessaire pour verifier et rattraper le travail apres la restauration technique.',
    content: `## Definition
Le **Work Recovery Time (WRT)** est le temps requis apres la restauration technique pour :
- Verifier l'integrite des donnees
- Rattraper les transactions perdues
- Reprendre les operations normales

## Relation avec RTO et MTPD
RTO + WRT doit rester inferieur ou egal au MTPD.

Le WRT est souvent oublie dans les calculs mais peut representer une part significative du delai total de reprise.

## Exemples
- Base de donnees : verification d'integrite, rejeu des journaux = 2h de WRT
- ERP : reconciliation des commandes manquantes = 4h de WRT
- Email : re-synchronisation des boites = 1h de WRT`,
    relatedTerms: ['RTO', 'MTPD', 'reprise', 'integrite'],
    source: 'NIST SP 800-34',
  },

  // ── PCA ──────────────────────────────────────────────────────────────
  {
    id: 'kb-pca',
    slug: 'pca-plan-continuite-activite',
    title: "PCA — Plan de Continuite d'Activite",
    category: 'PCA',
    tags: ['PCA', 'ISO22301', 'continuité', 'gouvernance'],
    summary: "Le PCA organise la continuite des operations durant une perturbation majeure.",
    content: `## Les 5 phases (ISO 22301)
1. **Comprendre le contexte**
2. **Leadership et gouvernance**
3. **Planification des capacites**
4. **Support et operation**
5. **Evaluation et amelioration continue**

## Contenu type
- Roles et responsabilites
- Scenarios de crise
- Procedures de contournement
- Plan de communication
- Plan de tests et d'exercices`,
    relatedTerms: ['PRA', 'crise', 'gouvernance'],
    source: 'ISO 22301',
  },
  {
    id: 'kb-pca-vs-pra',
    slug: 'pca-vs-pra-differences',
    title: 'PCA vs PRA : quelles differences ?',
    category: 'PCA',
    tags: ['PCA', 'PRA', 'comparaison', 'gouvernance'],
    summary: 'Comprendre les differences fondamentales entre Plan de Continuite et Plan de Reprise.',
    content: `## Vue d'ensemble

| Critere | PCA | PRA |
|---------|-----|-----|
| **Perimetre** | Organisation entiere | Systemes IT |
| **Objectif** | Maintenir l'activite | Restaurer l'IT |
| **Temporalite** | Pendant la crise | Apres le sinistre |
| **Responsable** | Direction generale | DSI / IT |
| **Inclut** | Communication, RH, logistique | Infrastructure, donnees, applications |

## Le PCA englobe le PRA
Le PRA est un composant technique du PCA. Un PCA sans PRA est incomplet, et un PRA sans PCA manque de contexte metier.

## Analogie
- **PCA** = "Comment l'entreprise continue de fonctionner"
- **PRA** = "Comment l'IT repart apres la panne"

## Dans la pratique
1. Le BIA alimente les deux plans
2. Le PCA definit les priorites metier
3. Le PRA traduit ces priorites en actions techniques
4. Les exercices valident l'ensemble`,
    relatedTerms: ['PCA', 'PRA', 'BIA', 'gouvernance'],
    source: 'ISO 22301 / AFNOR',
  },
  {
    id: 'kb-pca-crisis-communication',
    slug: 'communication-de-crise',
    title: 'Communication de crise dans le PCA',
    category: 'PCA',
    tags: ['PCA', 'communication', 'crise', 'gouvernance'],
    summary: "Comment structurer la communication interne et externe lors d'une crise majeure.",
    content: `## Principes fondamentaux
- **Rapidite** : communiquer dans l'heure suivant la detection
- **Transparence** : partager ce qui est connu et ce qui ne l'est pas
- **Coherence** : un seul porte-parole, un message unifie
- **Regularite** : points de situation a intervalles fixes

## Plan de communication type
### Communication interne
1. Alerte initiale aux equipes de crise
2. Information des managers
3. Communication a l'ensemble des employes
4. Points de situation reguliers

### Communication externe
1. Notification aux clients impactes
2. Communication aux partenaires et fournisseurs
3. Relations presse si necessaire
4. Notification aux regulateurs (si obligatoire)

## Outils recommandes
- Liste de contacts d'urgence (hors systemes IT)
- Templates de messages pre-rediges
- Canal de communication de secours (SMS, WhatsApp)
- Arbre d'appel hierarchique

## Erreurs a eviter
- Minimiser la situation
- Communiquer des informations non verifiees
- Attendre trop longtemps avant de communiquer
- Oublier certaines parties prenantes`,
    relatedTerms: ['PCA', 'crise', 'gouvernance', 'notification'],
    source: 'ISO 22301 §8.4.3',
  },
  {
    id: 'kb-mode-degrade',
    slug: 'mode-degrade',
    title: "Mode degrade : fonctionner sans l'IT",
    category: 'PCA',
    tags: ['PCA', 'mode-degrade', 'continuité', 'MBCO'],
    summary: "Strategies et procedures pour maintenir l'activite quand les systemes IT sont indisponibles.",
    content: `## Qu'est-ce que le mode degrade ?
Le mode degrade est un ensemble de procedures de contournement permettant de maintenir un niveau minimal d'activite (MBCO) sans les systemes IT habituels.

## Exemples de procedures
- **Ventes** : bons de commande papier, calculs manuels
- **Logistique** : suivi par tableur, appels telephoniques
- **Support** : formulaires papier, file d'attente physique
- **Comptabilite** : enregistrement manuel, rapprochement ulterieur

## Mise en place
1. Identifier les processus critiques couverts par le MBCO
2. Documenter les procedures manuelles pour chaque processus
3. Preparer les formulaires et outils hors-ligne
4. Former les equipes aux procedures degradees
5. Tester regulierement en conditions reelles

## Retour a la normale
- Definir les criteres de sortie du mode degrade
- Planifier la ressaisie des donnees manuelles
- Verifier la coherence entre donnees manuelles et systemes
- Documenter les ecarts et incidents`,
    relatedTerms: ['PCA', 'MBCO', 'continuité', 'contournement'],
    source: 'BCI Good Practice Guidelines §6',
  },

  // ── PRA ──────────────────────────────────────────────────────────────
  {
    id: 'kb-pra',
    slug: 'pra-plan-reprise-activite',
    title: "PRA — Plan de Reprise d'Activite",
    category: 'PRA',
    tags: ['PRA', 'DRP', 'reprise', 'architecture'],
    summary: 'Le PRA detaille comment restaurer les services IT apres sinistre.',
    content: `## Strategies classiques
- **Cold site**: infrastructure passive, reprise lente
- **Warm site**: pre-provisionnement partiel, reprise moderee
- **Hot site**: capacite presque immediate
- **Active-Active**: service distribue en continu

## Elements cles
- Inventaire des actifs critiques
- Sequence de reprise priorisee
- Playbooks techniques de bascule
- Exercices reguliers et retour d'experience`,
    relatedTerms: ['RTO', 'RPO', 'failover', 'PCA'],
    source: 'ISO 22301 §8.4',
  },
  {
    id: 'kb-pra-strategies',
    slug: 'strategies-reprise',
    title: 'Strategies de reprise IT',
    category: 'PRA',
    tags: ['PRA', 'architecture', 'failover', 'replication', 'cloud'],
    summary: 'Comparaison des strategies de reprise : cold, warm, hot site et cloud DR.',
    content: `## Comparaison des strategies

| Strategie | RTO | RPO | Cout | Complexite |
|-----------|-----|-----|------|------------|
| **Backup & Restore** | 24-72h | 24h | Faible | Faible |
| **Cold Site** | 12-24h | 12-24h | Faible | Moyenne |
| **Warm Site** | 4-12h | 1-4h | Moyen | Moyenne |
| **Hot Site** | 1-4h | Min-1h | Eleve | Elevee |
| **Active-Active** | ~0 | ~0 | Tres eleve | Tres elevee |
| **Cloud DR** | 1-4h | Min-1h | Variable | Moyenne |

## Cloud Disaster Recovery
Les services cloud offrent des options flexibles :
- **AWS** : Cross-Region replication, Route 53 failover, Pilot Light
- **Azure** : Azure Site Recovery, Traffic Manager, Geo-replication
- **GCP** : Cloud DNS failover, Cross-region load balancing

## Choisir la bonne strategie
1. Partir des objectifs RTO/RPO du BIA
2. Evaluer le budget disponible
3. Considerer la complexite operationnelle
4. Tester la solution choisie avant mise en production

## Pilot Light vs Warm Standby
- **Pilot Light** : seuls les composants critiques sont repliques (DB), le reste est provisionne a la demande
- **Warm Standby** : environnement complet actif mais sous-dimensionne, scale-up en cas de sinistre`,
    relatedTerms: ['PRA', 'failover', 'RTO', 'RPO', 'cloud', 'replication'],
    source: 'AWS Well-Architected Framework / NIST SP 800-34',
  },
  {
    id: 'kb-failover-switchover',
    slug: 'failover-switchover',
    title: 'Failover et Switchover : bascule IT',
    category: 'PRA',
    tags: ['failover', 'switchover', 'PRA', 'haute-disponibilite'],
    summary: 'Difference entre failover automatique et switchover manuel, et comment les mettre en oeuvre.',
    content: `## Definitions
- **Failover** : bascule automatique vers le site de secours quand le site primaire est detecte en panne
- **Switchover** : bascule manuelle planifiee (maintenance, test)

## Mecanismes courants
### Niveau reseau
- DNS failover (TTL court)
- BGP re-routing
- Load balancer health checks
- Anycast routing

### Niveau application
- Database replication failover (PostgreSQL streaming, MySQL Group Replication)
- Application cluster failover (Kubernetes, service mesh)
- Queue failover (message replay)

### Niveau stockage
- Replication synchrone / asynchrone
- Mirroring de volumes
- Object storage cross-region

## Risques du failover
- **Split-brain** : les deux sites se croient primaires
- **Donnees desynchronisees** : transactions en vol perdues
- **Cascade de pannes** : le site secondaire ne supporte pas la charge
- **Failback complexe** : le retour au site primaire peut etre plus difficile que la bascule initiale

## Bonnes pratiques
1. Automatiser la detection de panne (health checks multi-niveaux)
2. Tester le failover regulierement (au minimum trimestriel)
3. Documenter la procedure de failback
4. Monitorer la latence de replication en continu`,
    relatedTerms: ['PRA', 'failover', 'haute-disponibilite', 'replication'],
    source: 'NIST SP 800-34 §5.1',
  },
  {
    id: 'kb-backup-strategies',
    slug: 'strategies-sauvegarde',
    title: 'Strategies de sauvegarde',
    category: 'PRA',
    tags: ['backup', 'sauvegarde', 'RPO', 'PRA', 'regle-3-2-1'],
    summary: 'Bonnes pratiques de sauvegarde : regle 3-2-1, types de backup, et retention.',
    content: `## La regle 3-2-1
- **3** copies des donnees
- **2** supports de stockage differents
- **1** copie hors site (ou hors cloud region)

## Types de sauvegarde
- **Complete** : copie integrale, restauration rapide, stockage important
- **Incrementale** : uniquement les changements depuis le dernier backup, economique
- **Differentielle** : changements depuis le dernier backup complet, compromis

## Frequence et RPO
| RPO cible | Strategie recommandee |
|-----------|----------------------|
| < 1 min | Replication synchrone |
| 5-15 min | Replication asynchrone + journaux |
| 1-4h | Snapshots frequents |
| 12-24h | Backup quotidien |

## Tests de restauration
- Tester la restauration au moins une fois par trimestre
- Mesurer le temps reel de restauration (valider le RTO)
- Verifier l'integrite des donnees restaurees
- Documenter les ecarts et ajuster la strategie

## Immutabilite
Les sauvegardes doivent etre immutables (WORM) pour se proteger contre les ransomwares.`,
    relatedTerms: ['backup', 'RPO', 'PRA', 'restauration', 'ransomware'],
    source: 'NIST SP 800-34 §5.2 / ANSSI',
  },
  {
    id: 'kb-ransomware-response',
    slug: 'reponse-ransomware',
    title: 'Repondre a une attaque ransomware',
    category: 'PRA',
    tags: ['ransomware', 'cyber', 'incident', 'PRA', 'reponse'],
    summary: 'Procedure de reponse a une attaque par ransomware dans le cadre du PRA.',
    content: `## Detection et alerte
1. Identifier les signaux : fichiers chiffres, note de rancon, alertes antivirus
2. Confirmer l'attaque avec l'equipe securite
3. Activer la cellule de crise

## Confinement immediat (premieres heures)
- **Isoler** les systemes infectes du reseau
- **Ne pas eteindre** les machines (preservation des preuves)
- **Bloquer** la propagation laterale (segmentation reseau)
- **Preserver** les logs et evidences numeriques

## Evaluation de l'impact
- Quels systemes sont touches ?
- Les sauvegardes sont-elles intactes ?
- Des donnees ont-elles ete exfiltrees ?
- Quel est le perimetre de l'incident ?

## Reprise
1. Restaurer depuis des sauvegardes verifiees et saines
2. Reconstruire les systemes compromis (ne pas simplement dechiffrer)
3. Appliquer les correctifs de securite
4. Renforcer les acces (reset des mots de passe)
5. Monitorer intensivement pendant 30 jours

## Faut-il payer la rancon ?
- **Position ANSSI/FBI** : Ne pas payer
- Payer ne garantit pas la recuperation des donnees
- Payer finance les attaquants et encourage de nouvelles attaques
- Des outils de dechiffrement gratuits existent parfois (No More Ransom)

## Communication
- Notifier les autorites (ANSSI, CNIL si donnees personnelles)
- Informer les parties prenantes
- Preparer un communique si fuite de donnees`,
    relatedTerms: ['ransomware', 'cyber', 'incident', 'PRA', 'sauvegarde'],
    source: 'ANSSI / NIST Cybersecurity Framework',
  },

  // ── Gouvernance ──────────────────────────────────────────────────────
  {
    id: 'kb-governance-roles',
    slug: 'roles-gouvernance-pca',
    title: 'Roles et gouvernance du PCA',
    category: 'governance',
    tags: ['gouvernance', 'PCA', 'roles', 'responsabilites', 'comite-crise'],
    summary: "Organisation et roles cles pour piloter la continuite d'activite.",
    content: `## Structure de gouvernance

### Niveau strategique
- **Sponsor executif** : membre du COMEX, porte la vision
- **Comite de pilotage PCA** : valide la strategie, alloue les budgets

### Niveau tactique
- **Responsable PCA (BCM Manager)** : pilote le programme au quotidien
- **Coordinateurs metier** : relais dans chaque direction
- **RSSI** : assure l'alignement cybersecurite

### Niveau operationnel
- **Cellule de crise** : active en cas d'incident majeur
- **Equipes de reprise** : executent les procedures PRA
- **Support utilisateurs** : assurent la communication terrain

## Comite de crise
### Composition type
- Directeur general ou delegue
- Responsable PCA
- DSI
- Directeur communication
- Responsable RH
- Responsables des BU impactees

### Fonctionnement
- Activation sur criteres pre-definis
- Reunions a rythme fixe (toutes les heures en crise aigue)
- Compte-rendu de decisions systematique
- Criteres de desactivation clairs`,
    relatedTerms: ['PCA', 'gouvernance', 'crise', 'roles'],
    source: 'ISO 22301 §5 / BCI GPG',
  },
  {
    id: 'kb-risk-assessment',
    slug: 'analyse-risques-pca',
    title: 'Analyse de risques pour le PCA',
    category: 'governance',
    tags: ['risques', 'BIA', 'PCA', 'menaces', 'vulnerabilites'],
    summary: "Identifier et evaluer les risques pouvant impacter la continuite d'activite.",
    content: `## Methodologie
L'analyse de risques dans le cadre du PCA identifie les menaces susceptibles de perturber les processus critiques identifies par le BIA.

## Categories de menaces
### Naturelles
- Inondation, seisme, tempete
- Canicule, grand froid
- Pandemie

### Technologiques
- Panne de datacenter
- Rupture de lien telecom
- Defaillance logicielle majeure
- Cyberattaque (ransomware, DDoS)

### Humaines
- Erreur d'exploitation
- Greve, mouvement social
- Depart de personnel cle
- Acte malveillant interne

### Externes
- Defaillance d'un fournisseur critique
- Panne du reseau electrique
- Probleme de chaine d'approvisionnement

## Matrice de risques
Chaque risque est evalue selon :
- **Probabilite** : rare, peu probable, possible, probable, quasi-certain
- **Impact** : negligeable, mineur, modere, majeur, catastrophique

## Actions
- **Eviter** : supprimer l'activite a risque
- **Reduire** : mettre en place des mesures de prevention
- **Transferer** : assurance, sous-traitance
- **Accepter** : risque residuel documente et approuve`,
    relatedTerms: ['risques', 'menaces', 'BIA', 'PCA'],
    source: 'ISO 31000 / ISO 22301 §8.2.3',
  },
  {
    id: 'kb-glossary-general',
    slug: 'glossaire-pca-pra',
    title: 'Glossaire PCA / PRA / BIA',
    category: 'governance',
    tags: ['glossaire', 'definitions', 'PCA', 'PRA', 'BIA', 'vocabulaire'],
    summary: "Lexique des termes essentiels de la continuite d'activite et de la reprise apres sinistre.",
    content: `## A
- **AZ** (Availability Zone) : zone de disponibilite dans un datacenter cloud

## B
- **BCP** (Business Continuity Plan) : equivalent anglais du PCA
- **BIA** (Business Impact Analysis) : analyse d'impact sur l'activite

## C
- **COOP** (Continuity of Operations Plan) : plan de continuite des operations (terminologie US)

## D
- **DRP** (Disaster Recovery Plan) : equivalent anglais du PRA
- **DORA** : Digital Operational Resilience Act (reglement UE)

## F
- **Failover** : bascule automatique vers un systeme de secours
- **Failback** : retour sur le systeme primaire apres reparation

## H
- **HA** (High Availability) : haute disponibilite

## M
- **MBCO** (Minimum Business Continuity Objective) : niveau de service minimal en crise
- **MTPD** (Maximum Tolerable Period of Disruption) : duree maximale de perturbation tolerable

## R
- **RETEX** : retour d'experience post-exercice ou post-incident
- **RPO** (Recovery Point Objective) : perte de donnees maximale acceptable
- **RTO** (Recovery Time Objective) : delai de reprise maximal

## S
- **SLA** (Service Level Agreement) : engagement de niveau de service
- **SMCA** : Systeme de Management de la Continuite d'Activite
- **SPOF** (Single Point of Failure) : point de defaillance unique
- **Switchover** : bascule manuelle planifiee

## W
- **WORM** (Write Once Read Many) : stockage immutable
- **WRT** (Work Recovery Time) : temps de reprise operationnelle apres restauration technique`,
    relatedTerms: ['glossaire', 'definitions', 'PCA', 'PRA', 'BIA'],
    source: 'ISO 22301 / NIST SP 800-34 / BCI',
  },

  // ── Regulation ───────────────────────────────────────────────────────
  {
    id: 'kb-iso-22301',
    slug: 'iso-22301-overview',
    title: 'ISO 22301 : la norme de reference',
    category: 'regulation',
    tags: ['ISO22301', 'norme', 'certification', 'PCA', 'gouvernance'],
    summary: "Presentation de la norme ISO 22301, structure et exigences pour un SMCA.",
    content: `## Qu'est-ce que l'ISO 22301 ?
La norme **ISO 22301** (Management de la Continuite d'Activite) definit les exigences pour un **Systeme de Management de la Continuite d'Activite (SMCA)**.

## Structure (Plan-Do-Check-Act)
### Plan
- §4 Contexte de l'organisation
- §5 Leadership
- §6 Planification

### Do
- §7 Support (ressources, competences, communication)
- §8 Fonctionnement (BIA, strategies, plans)

### Check
- §9 Evaluation des performances (audit, revue de direction)

### Act
- §10 Amelioration continue

## Exigences cles
- Realiser un BIA et une analyse de risques (§8.2)
- Definir des strategies de continuite (§8.3)
- Etablir et maintenir des plans (§8.4)
- Realiser des exercices et tests (§8.5)
- Ameliorer en continu le SMCA (§10)

## Certification
- Audit de certification par un organisme accredite
- Surveillance annuelle
- Renouvellement tous les 3 ans
- Compatible avec ISO 27001 (securite de l'information)`,
    relatedTerms: ['ISO22301', 'SMCA', 'certification', 'PCA'],
    source: 'ISO 22301:2019',
  },
  {
    id: 'kb-dora',
    slug: 'dora-reglement-europeen',
    title: 'DORA : resilience numerique dans la finance',
    category: 'regulation',
    tags: ['DORA', 'regulation', 'finance', 'resilience', 'UE'],
    summary: "Le reglement DORA impose des exigences de resilience operationnelle numerique aux entites financieres de l'UE.",
    content: `## Qu'est-ce que DORA ?
Le **Digital Operational Resilience Act (DORA)** est un reglement europeen (UE 2022/2554) entre en application le 17 janvier 2025.

## Qui est concerne ?
- Banques et etablissements de credit
- Entreprises d'investissement
- Compagnies d'assurance
- Fournisseurs de services de paiement
- Fournisseurs tiers de services IT critiques (cloud, SaaS)

## 5 piliers de DORA
1. **Gestion des risques IT** : cadre de gouvernance et politique de risques
2. **Reporting d'incidents** : notification aux autorites dans les delais prescrits
3. **Tests de resilience** : tests reguliers incluant des tests de penetration avances (TLPT)
4. **Gestion des risques tiers** : surveillance des fournisseurs IT critiques
5. **Partage d'information** : echange de renseignements sur les cybermenaces

## Impact sur le PCA/PRA
- Les tests de continuite doivent etre plus frequents et documentes
- Les fournisseurs cloud doivent demontrer leur resilience
- Les incidents majeurs doivent etre reportes dans les 4 heures
- Des scenarios de crise cyber doivent etre testes annuellement`,
    relatedTerms: ['DORA', 'regulation', 'resilience', 'PCA', 'PRA'],
    source: 'Reglement (UE) 2022/2554',
  },
  {
    id: 'kb-nist-800-34',
    slug: 'nist-sp-800-34',
    title: 'NIST SP 800-34 : guide de contingence IT',
    category: 'regulation',
    tags: ['NIST', 'contingence', 'PRA', 'guide', 'gouvernance'],
    summary: "Le guide NIST SP 800-34 fournit un cadre pour la planification de la contingence des systemes d'information.",
    content: `## Presentation
Le **NIST SP 800-34 Rev.1** est le guide de reference americain pour la planification de la contingence des systemes d'information.

## 7 etapes du processus
1. **Developper la politique** de contingence
2. **Realiser le BIA** (Business Impact Analysis)
3. **Identifier les mesures preventives**
4. **Developper les strategies de reprise**
5. **Developper le plan de contingence**
6. **Tester et exercer** le plan
7. **Maintenir** le plan a jour

## Types de plans selon le NIST
- **BCP** : Business Continuity Plan
- **DRP** : Disaster Recovery Plan (equivalent PRA)
- **COOP** : Continuity of Operations Plan
- **ISCP** : Information System Contingency Plan
- **CMP** : Crisis Management Plan

## Metriques definies
- **RTO** : Recovery Time Objective
- **RPO** : Recovery Point Objective
- **SDO** : Service Delivery Objective (niveau de service cible)

## Complementarite avec ISO 22301
Le NIST SP 800-34 est plus operationnel et technique, tandis que l'ISO 22301 est un cadre de management. Les deux sont complementaires.`,
    relatedTerms: ['NIST', 'contingence', 'BIA', 'PRA', 'DRP'],
    source: 'NIST SP 800-34 Rev.1',
  },

  // ── Architecture & resilience ────────────────────────────────────────
  {
    id: 'kb-haute-disponibilite',
    slug: 'haute-disponibilite',
    title: 'Haute disponibilite (HA)',
    category: 'architecture',
    tags: ['haute-disponibilite', 'HA', 'redundance', 'SLA', 'architecture'],
    summary: 'Principes et architectures pour atteindre une haute disponibilite des services IT.',
    content: `## Definition
La **haute disponibilite (HA)** designe la capacite d'un systeme a rester operationnel avec un taux d'uptime tres eleve (99.9% et plus).

## Les "nines" de disponibilite

| Niveau | Uptime | Downtime/an |
|--------|--------|-------------|
| 99% | "Two nines" | 3.65 jours |
| 99.9% | "Three nines" | 8.77 heures |
| 99.99% | "Four nines" | 52.60 minutes |
| 99.999% | "Five nines" | 5.26 minutes |

## Principes architecturaux
### Elimination des SPOF
- Redundance a chaque couche (reseau, compute, stockage)
- Load balancing actif-actif
- Multi-AZ ou multi-region

### Detection et reaction
- Health checks automatises
- Auto-healing (redemarrage, re-provisionnement)
- Circuit breakers et graceful degradation

### Donnees
- Replication synchrone pour RPO~0
- Consensus distribue (Raft, Paxos)
- Sharding pour la scalabilite

## Patterns cloud
- **Multi-AZ** : replique dans la meme region, latence faible
- **Multi-Region** : protection contre la panne regionale, complexite elevee
- **Active-Active** : trafic distribue sur plusieurs sites
- **Active-Passive** : site de secours en standby`,
    relatedTerms: ['HA', 'SPOF', 'redundance', 'SLA', 'failover'],
    source: 'AWS Well-Architected Framework / Azure Architecture Center',
  },
  {
    id: 'kb-spof',
    slug: 'spof-single-point-of-failure',
    title: 'SPOF : identifier les points de defaillance uniques',
    category: 'architecture',
    tags: ['SPOF', 'redundance', 'architecture', 'resilience', 'analyse'],
    summary: 'Comment detecter et eliminer les Single Points of Failure dans votre infrastructure.',
    content: `## Qu'est-ce qu'un SPOF ?
Un **Single Point of Failure (SPOF)** est un composant dont la defaillance entraine l'arret complet d'un service. L'absence de redundance a ce point cree un risque critique.

## SPOF courants
### Infrastructure
- Serveur unique sans cluster
- Lien reseau unique vers le datacenter
- Alimentation electrique sans onduleur / sans double adduction

### Logiciel
- Base de donnees mono-instance
- Service centralisateur sans fallback
- File de messages sans replication

### Humain
- Expert unique sur un systeme critique ("bus factor = 1")
- Processus qui depend d'une seule personne

### Fournisseur
- Fournisseur cloud unique sans multi-cloud
- Fournisseur telecom unique

## Comment les detecter
1. **Cartographie des dependances** (ce que fait Stronghold)
2. **Analyse de graphe** : identifier les noeuds dont la suppression deconnecte le graphe
3. **Tests de chaos** : simuler la panne de chaque composant
4. **Revue d'architecture** : audit systematique couche par couche

## Remediation
- Ajouter de la redundance (cluster, replica, multi-path)
- Diversifier les fournisseurs
- Documenter et former plusieurs personnes
- Automatiser les bascules (failover)`,
    relatedTerms: ['SPOF', 'redundance', 'resilience', 'failover', 'chaos-engineering'],
    source: 'SRE Book (Google) / NIST SP 800-34',
  },
  {
    id: 'kb-chaos-engineering',
    slug: 'chaos-engineering',
    title: 'Chaos Engineering : tester la resilience',
    category: 'architecture',
    tags: ['chaos-engineering', 'test', 'resilience', 'simulation', 'Netflix'],
    summary: 'Injecter des pannes controlees pour valider la resilience de vos systemes.',
    content: `## Principes
Le **Chaos Engineering** consiste a experimenter sur un systeme en production (ou pre-production) pour verifier sa capacite a resister a des conditions turbulentes.

## Les 5 principes (Netflix)
1. **Definir l'etat stable** : mesurer le comportement normal
2. **Formuler une hypothese** : "le systeme resiste a la panne de X"
3. **Introduire des variables reelles** : panne serveur, latence reseau, saturation disque
4. **Observer les ecarts** : comparer avec l'etat stable
5. **Minimiser le rayon d'explosion** : commencer petit, limiter l'impact

## Types d'injection
- **Infrastructure** : arret de VM/container, perte de zone
- **Reseau** : latence, perte de paquets, partition
- **Application** : erreurs d'API, saturation de ressources
- **Dependances** : indisponibilite d'un service tiers

## Outils
- **Chaos Monkey** (Netflix) : arret aleatoire d'instances
- **Gremlin** : plateforme de chaos as a service
- **Litmus** : chaos engineering pour Kubernetes
- **AWS Fault Injection Simulator** : service AWS natif

## Lien avec le PRA
Les exercices de chaos engineering completent les tests PRA en validant les mecanismes de failover en conditions reelles.`,
    relatedTerms: ['chaos-engineering', 'resilience', 'simulation', 'failover', 'test'],
    source: 'Principles of Chaos Engineering (principlesofchaos.org)',
  },
  {
    id: 'kb-cloud-resilience',
    slug: 'resilience-cloud',
    title: 'Resilience dans le cloud',
    category: 'architecture',
    tags: ['cloud', 'resilience', 'AWS', 'Azure', 'GCP', 'multi-cloud', 'architecture'],
    summary: 'Architecturer la resilience dans les environnements cloud : regions, zones, et services manages.',
    content: `## Concepts cloud fondamentaux

### Regions et zones de disponibilite
- **Region** : zone geographique (ex: eu-west-1)
- **Availability Zone (AZ)** : datacenter isole dans une region
- **Multi-AZ** : repartir sur 2-3 AZ pour la HA intra-region
- **Multi-Region** : repartir sur 2+ regions pour le DR

### Responsabilite partagee
- **Le cloud provider** assure : infrastructure physique, reseau, hyperviseur
- **Le client** assure : configuration, donnees, sauvegardes, PRA applicatif

## Patterns de resilience cloud
### Backup & Restore
- Sauvegardes cross-region automatisees
- RTO: 12-24h, RPO: 1-24h
- Cout: faible

### Pilot Light
- Composants critiques (DB) repliques en continu
- Le reste est provisionne a la demande en cas de sinistre
- RTO: 2-4h, RPO: minutes

### Warm Standby
- Environnement miroir sous-dimensionne toujours actif
- Scale-up automatique en cas de bascule
- RTO: 30min-2h, RPO: secondes-minutes

### Multi-site Active-Active
- Trafic distribue sur plusieurs regions
- RTO: ~0, RPO: ~0
- Cout: le plus eleve

## Pieges a eviter
- Supposer que "cloud = resilient" sans configuration
- Oublier de tester les restaurations cross-region
- Ne pas surveiller les quotas et limites de service
- Dependance a un seul fournisseur sans strategie de sortie`,
    relatedTerms: ['cloud', 'resilience', 'multi-cloud', 'HA', 'failover'],
    source: 'AWS Reliability Pillar / Azure Architecture Center',
  },

  // ── Tests & exercices ────────────────────────────────────────────────
  {
    id: 'kb-exercices-pca',
    slug: 'exercices-tests-pca',
    title: 'Exercices et tests du PCA/PRA',
    category: 'testing',
    tags: ['exercices', 'test', 'PCA', 'PRA', 'simulation', 'validation'],
    summary: "Types d'exercices pour valider le PCA/PRA, de la revue documentaire au test grandeur nature.",
    content: `## Pourquoi tester ?
Un plan non teste est un plan qui ne fonctionne pas. Les exercices permettent de :
- Valider les procedures documentees
- Identifier les lacunes et les incoherences
- Former les equipes aux procedures de crise
- Satisfaire les exigences reglementaires

## Types d'exercices (par ordre de complexite)

### 1. Revue documentaire (Desktop Review)
- **Effort** : Faible
- **Objectif** : Verifier que les plans sont a jour et coherents
- **Frequence** : Semestrielle

### 2. Walk-through (revue guidee)
- **Effort** : Faible a moyen
- **Objectif** : Les equipes parcourent les procedures etape par etape
- **Frequence** : Semestrielle

### 3. Exercice sur table (Tabletop)
- **Effort** : Moyen
- **Objectif** : Simulation d'un scenario en salle avec discussion
- **Frequence** : Annuelle

### 4. Exercice fonctionnel
- **Effort** : Eleve
- **Objectif** : Execution reelle des procedures techniques (failover, restauration)
- **Frequence** : Annuelle

### 5. Exercice grandeur nature (Full-scale)
- **Effort** : Tres eleve
- **Objectif** : Simulation complete impliquant toute l'organisation
- **Frequence** : Bisannuelle

## Retour d'experience (RETEX)
Apres chaque exercice :
1. Collecter les observations a chaud
2. Analyser les ecarts par rapport aux attendus
3. Rediger un rapport avec les actions correctives
4. Suivre la mise en oeuvre des corrections
5. Mettre a jour les plans en consequence`,
    relatedTerms: ['exercices', 'test', 'PCA', 'PRA', 'RETEX', 'simulation'],
    source: 'ISO 22301 §8.5 / BCI GPG §8',
  },
  {
    id: 'kb-tabletop-exercises',
    slug: 'exercice-tabletop',
    title: 'Organiser un exercice sur table (Tabletop)',
    category: 'testing',
    tags: ['exercices', 'tabletop', 'simulation', 'crise', 'scenario'],
    summary: 'Guide pratique pour organiser et animer un exercice de simulation de crise sur table.',
    content: `## Qu'est-ce qu'un Tabletop ?
Un exercice sur table est une simulation de crise en salle de reunion ou les participants discutent de leurs reactions face a un scenario fictif mais realiste.

## Preparation (2-4 semaines avant)
1. **Definir l'objectif** : que veut-on valider ?
2. **Choisir le scenario** : ransomware, panne cloud, inondation...
3. **Identifier les participants** : equipe de crise, IT, metier, direction
4. **Preparer le script** : chronologie des evenements, "injects" (rebondissements)
5. **Logistique** : salle, supports, chronometre

## Deroulement type (2-3 heures)
### Phase 1 — Introduction (15 min)
- Rappel des objectifs et regles
- Presentation du scenario initial

### Phase 2 — Reaction (60-90 min)
- Le facilitateur deroule le scenario par injects successifs
- Les participants decrivent leurs actions, decisions, communications
- Discussion ouverte sur les options

### Phase 3 — Debriefing (30-45 min)
- Tour de table : ce qui a bien fonctionne / a ameliorer
- Identification des actions correctives
- Synthese par le facilitateur

## Scenarios recommandes
- Ransomware avec chiffrement du SI
- Panne majeure du fournisseur cloud
- Indisponibilite du batiment principal
- Fuite de donnees personnelles (RGPD)
- Defaillance d'un fournisseur critique

## Conseils de l'animateur
- Rester neutre, ne pas juger les reponses
- Encourager la participation de tous
- Introduire des rebondissements realistes
- Chronometrer les phases de reaction`,
    relatedTerms: ['tabletop', 'exercices', 'simulation', 'crise', 'scenario'],
    source: 'FEMA HSEEP / BCI GPG §8',
  },
  {
    id: 'kb-maturity-model',
    slug: 'modele-maturite-pca',
    title: 'Modele de maturite PCA',
    category: 'testing',
    tags: ['maturite', 'PCA', 'gouvernance', 'amelioration', 'audit'],
    summary: "Evaluer et ameliorer le niveau de maturite de votre programme de continuite d'activite.",
    content: `## Les 5 niveaux de maturite

### Niveau 1 — Initial
- Pas de programme PCA formalise
- Reactions ad hoc en cas d'incident
- Pas de documentation

### Niveau 2 — Reactif
- Quelques plans existent mais incomplets
- BIA partiel sur les systemes critiques
- Tests sporadiques

### Niveau 3 — Defini
- Programme PCA formalise et documente
- BIA complet avec RTO/RPO valides
- Exercices annuels planifies
- Gouvernance etablie

### Niveau 4 — Gere
- Metriques de performance du PCA suivies
- Integration avec la gestion des risques
- Exercices reguliers avec RETEX structure
- Amelioration continue basee sur les indicateurs

### Niveau 5 — Optimise
- PCA integre dans la culture d'entreprise
- Automatisation des tests et de la detection
- Innovation continue (chaos engineering, DR as code)
- Benchmark avec les pairs du secteur

## Comment progresser
- Evaluer le niveau actuel sur chaque axe
- Definir un objectif realiste a 12-18 mois
- Prioriser les chantiers selon l'impact / effort
- Mesurer la progression regulierement`,
    relatedTerms: ['maturite', 'PCA', 'amelioration', 'gouvernance'],
    source: 'BCI Maturity Model / ISO 22301',
  },
];

export const KNOWLEDGE_BASE_CATEGORIES = [
  { id: 'BIA', label: 'Business Impact Analysis', description: "Analyse d'impact sur les activites", icon: 'bar-chart' },
  { id: 'PCA', label: 'Plan de Continuite', description: "Maintenir l'activite en cas de crise", icon: 'shield' },
  { id: 'PRA', label: 'Plan de Reprise', description: 'Restaurer les services IT apres sinistre', icon: 'refresh-cw' },
  { id: 'resilience-metrics', label: 'Metriques de resilience', description: 'RTO, RPO, MTPD et indicateurs', icon: 'activity' },
  { id: 'governance', label: 'Gouvernance', description: 'Roles, risques et organisation', icon: 'users' },
  { id: 'regulation', label: 'Normes & Reglements', description: 'ISO 22301, DORA, NIST', icon: 'file-text' },
  { id: 'architecture', label: 'Architecture & Resilience', description: 'HA, SPOF, cloud et chaos engineering', icon: 'server' },
  { id: 'testing', label: 'Tests & Exercices', description: 'Exercices, tabletop et maturite', icon: 'clipboard-check' },
] as const;
