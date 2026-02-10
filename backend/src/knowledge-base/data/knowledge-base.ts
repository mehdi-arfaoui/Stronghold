export interface KnowledgeBaseArticle {
  id: string;
  slug: string;
  title: string;
  category: 'BIA' | 'PRA' | 'PCA' | 'resilience-metrics';
  tags: string[];
  summary: string;
  content: string;
  relatedTerms: string[];
  source: string;
}

export const KNOWLEDGE_BASE_ARTICLES: KnowledgeBaseArticle[] = [
  {
    id: 'kb-bia-definition',
    slug: 'quest-ce-quun-bia',
    title: "Qu'est-ce qu'un BIA ?",
    category: 'BIA',
    tags: ['BIA', 'ISO22301', 'analyse-impact', 'RTO', 'RPO', 'MTPD'],
    summary: "Le BIA identifie les activites critiques, leurs impacts metier et les objectifs de reprise.",
    content: `## Definition\nLe **Business Impact Analysis (BIA)** est une analyse structuree qui identifie les processus critiques et quantifie les impacts d'une interruption.\n\n## Objectifs\n- Prioriser les services critiques\n- Determiner les tolerances d'interruption\n- Fixer des objectifs de reprise (RTO, RPO, MTPD)\n\n## Metriques\n- **RTO**: delai maximal pour restaurer le service\n- **RPO**: perte de donnees acceptable\n- **MTPD**: duree maximale de perturbation tolerable\n\n## Etapes\n1. Inventorier les processus\n2. Evaluer impacts financiers, operationnels, reputations\n3. Definir criticite et priorites\n4. Valider les objectifs de reprise`,
    relatedTerms: ['RTO', 'RPO', 'MTPD', 'criticite'],
    source: 'ISO 22301 §8.2.2',
  },
  {
    id: 'kb-rto-explained',
    slug: 'rto-explique',
    title: 'RTO explique',
    category: 'resilience-metrics',
    tags: ['RTO', 'BIA', 'PRA', 'MTPD', 'RPO'],
    summary: 'Le RTO est le temps maximal acceptable pour remettre un service en etat operationnel.',
    content: `## Definition\nLe **Recovery Time Objective (RTO)** represente le temps cible maximal de restauration d'un service apres incident.\n\n## Comment le determiner\n- Evaluer l'impact metier par heure d'arret\n- Prendre en compte obligations reglementaires\n- Aligner capacites techniques et SLA\n\n## Exemples\n- Paiement en ligne: RTO 15-30 min\n- ERP: RTO 2-4 h\n- Intranet documentaire: RTO 8-24 h\n\n## Relation avec RPO et MTPD\n- RTO doit rester <= MTPD\n- RPO influence le mode de reprise et les technologies de replication`,
    relatedTerms: ['RPO', 'MTPD', 'SLA', 'failover'],
    source: 'ISO 22301 §8.4.1',
  },
  {
    id: 'kb-rpo-explained',
    slug: 'rpo-explique',
    title: 'RPO explique',
    category: 'resilience-metrics',
    tags: ['RPO', 'backup', 'replication', 'PRA'],
    summary: 'Le RPO mesure la quantite maximale de donnees que l organisation accepte de perdre.',
    content: `## Definition\nLe **Recovery Point Objective (RPO)** definit la perte de donnees maximale tolerable exprimee en temps.\n\n## Impact architectural\n- RPO proche de 0: replication synchrone / active-active\n- RPO de quelques minutes: replication asynchrone frequente\n- RPO de plusieurs heures: sauvegardes periodiques\n\n## Decision pratique\nChoisir un RPO doit equilibrer cout, complexite et criticite metier.`,
    relatedTerms: ['RTO', 'replication', 'backup', 'journalisation'],
    source: 'NIST SP 800-34 §3.4.2',
  },
  {
    id: 'kb-mtpd-explained',
    slug: 'mtpd-explique',
    title: 'MTPD explique',
    category: 'resilience-metrics',
    tags: ['MTPD', 'RTO', 'BIA'],
    summary: "Le MTPD est la duree maximale pendant laquelle un processus peut etre interrompu sans dommage inacceptable.",
    content: `## Definition\nLe **Maximum Tolerable Period of Disruption (MTPD)** est la limite absolue d'interruption acceptable pour un processus.\n\n## Difference avec le RTO\n- **MTPD**: seuil de rupture metier\n- **RTO**: objectif technique pour restaurer avant ce seuil\n\n## Evaluation\n- Identifier le point de non-retour metier\n- Quantifier impacts cumules (financiers, juridiques, image)\n- Valider avec les responsables metier`,
    relatedTerms: ['RTO', 'BIA', 'continuité'],
    source: 'ISO 22301 §8.2.2',
  },
  {
    id: 'kb-pca',
    slug: 'pca-plan-continuite-activite',
    title: "PCA — Plan de Continuite d'Activite",
    category: 'PCA',
    tags: ['PCA', 'ISO22301', 'continuité', 'gouvernance'],
    summary: 'Le PCA organise la continuite des operations durant une perturbation majeure.',
    content: `## Les 5 phases (ISO 22301)\n1. **Comprendre le contexte**\n2. **Leadership et gouvernance**\n3. **Planification des capacites**\n4. **Support et operation**\n5. **Evaluation et amelioration continue**\n\n## Contenu type\n- Roles et responsabilites\n- Scenarios de crise\n- Procedures de contournement\n- Plan de communication\n- Plan de tests et d'exercices`,
    relatedTerms: ['PRA', 'crise', 'gouvernance'],
    source: 'ISO 22301',
  },
  {
    id: 'kb-pra',
    slug: 'pra-plan-reprise-activite',
    title: "PRA — Plan de Reprise d'Activite",
    category: 'PRA',
    tags: ['PRA', 'DRP', 'reprise', 'architecture'],
    summary: 'Le PRA detaille comment restaurer les services IT apres sinistre.',
    content: `## Strategies classiques\n- **Cold site**: infrastructure passive, reprise lente\n- **Warm site**: pre-provisionnement partiel, reprise moderee\n- **Hot site**: capacite presque immediate\n- **Active-Active**: service distribue en continu\n\n## Elements cles\n- Inventaire des actifs critiques\n- Sequence de reprise priorisee\n- Playbooks techniques de bascule\n- Exercices reguliers et retour d'experience`,
    relatedTerms: ['RTO', 'RPO', 'failover', 'PCA'],
    source: 'ISO 22301 §8.4',
  },
];
