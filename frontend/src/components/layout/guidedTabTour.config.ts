export type GuidedTabId =
  | 'dashboard'
  | 'settings'
  | 'discovery'
  | 'analysis'
  | 'business-flows'
  | 'recommendations'
  | 'finance'
  | 'simulations'
  | 'drift'
  | 'runbooks'
  | 'pra-exercises'
  | 'incidents'
  | 'documents'
  | 'report'
  | 'knowledge-base';

export interface GuidedTabSection {
  heading: string;
  items: string[];
}

export interface GuidedTabGuide {
  id: GuidedTabId;
  route: string;
  title: string;
  sections: GuidedTabSection[];
}

export const GUIDED_TAB_CONTENT_AREA_ID = 'guided-tab-content-area';

export const GUIDED_TAB_GUIDES: GuidedTabGuide[] = [
  {
    id: 'dashboard',
    route: '/dashboard',
    title: 'Tableau de bord',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'La vue d ensemble de votre posture de resilience: score global, alertes actives, RTO/RPO moyens, SPOF detectes et couverture PRA.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Identifier en un coup d oeil les points d attention prioritaires.',
          'Naviguer directement vers les modules concernes depuis les cartes cliquables.',
        ],
      },
    ],
  },
  {
    id: 'settings',
    route: '/settings',
    title: 'Parametres',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'La configuration de votre tenant: informations entreprise, preferences d affichage, utilisateurs et integrations.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Personnaliser votre environnement Stronghold.',
          'Gerer les acces utilisateurs.',
          'Configurer les connecteurs cloud, ITSM et notifications.',
        ],
      },
    ],
  },
  {
    id: 'discovery',
    route: '/discovery',
    title: 'Decouverte',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'La cartographie complete de votre infrastructure: chaque noeud represente un service, une application, un serveur ou un service tiers, et les liens affichent leurs dependances.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Explorer le graphe avec zoom, pan et details de noeud.',
          'Identifier visuellement les clusters et points d interconnexion.',
          'Filtrer par type de service (cloud, on-premise, SaaS).',
          'Lancer un nouveau scan ou importer des donnees complementaires.',
        ],
      },
      {
        heading: 'Astuce',
        items: ['Les noeuds en rouge signalent des SPOF (Single Points of Failure) detectes automatiquement.'],
      },
    ],
  },
  {
    id: 'analysis',
    route: '/analysis',
    title: 'Analyse & BIA',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'L analyse automatique de votre infrastructure: score de resilience par service, criticite, redondance et BIA avec estimations RTO/RPO.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Valider ou ajuster les suggestions IA sur les cases colorees.',
          'Definir les RTO/RPO cibles et classer les services par criticite metier.',
          'Valider les estimations pour qu elles soient prises en compte dans les calculs financiers.',
        ],
      },
      {
        heading: 'Sous-onglets',
        items: ['Score de resilience', 'SPOF detectes', 'BIA detaille', 'Cout d indisponibilite'],
      },
    ],
  },
  {
    id: 'business-flows',
    route: '/business-flows',
    title: 'Flux Metier',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Les flux metiers de votre organisation, relies aux services techniques qu ils supportent.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Creer ou modifier un flux metier en selectionnant les services impliques.',
          'Consulter les recommandations IA par flux.',
          'Utiliser Cloud Enrich pour enrichir automatiquement les flux avec les metadonnees cloud.',
        ],
      },
      {
        heading: 'Parcours',
        items: [
          'Selectionnez un flux existant pour le visualiser, ou cliquez sur "Creer un flux" pour en definir un nouveau depuis votre cartographie.',
        ],
      },
    ],
  },
  {
    id: 'recommendations',
    route: '/recommendations',
    title: 'Recommandations',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Les recommandations IA priorisees pour renforcer votre resilience, avec cout estime, ROI, payback et strategies comparees.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Accepter ou rejeter chaque recommandation.',
          'Comparer les strategies selon cout, impact et complexite.',
          'Filtrer par priorite ou categorie.',
          'Transformer une recommandation en tache actionnable.',
        ],
      },
      {
        heading: 'Note',
        items: [
          'Les recommandations sont triees par score composite (impact / effort), et le statut peut etre modifie a tout moment.',
        ],
      },
    ],
  },
  {
    id: 'finance',
    route: '/finance',
    title: 'ROI & Finance',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Le tableau de bord financier de votre resilience: cout total d indisponibilite, investissements recommandes, ROI global et economies projetees.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Visualiser l impact financier de votre posture actuelle.',
          'Comparer des scenarios d investissement.',
          'Exporter les donnees pour les comites de direction.',
        ],
      },
      {
        heading: 'Important',
        items: ['Seules les estimations BIA validees sont incluses dans ces calculs.'],
      },
    ],
  },
  {
    id: 'simulations',
    route: '/simulations',
    title: 'Simulations',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'La bibliotheque de scenarios de simulation: ransomware, perte de region cloud, panne fournisseur critique, etc.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Lancer une simulation pour visualiser l impact en cascade sur votre infrastructure et vos activites.',
          'Suivre dans la War Room les noeuds impactes en temps reel et les metriques financieres (cout d indisponibilite, perte cumulee, cout de recovery).',
        ],
      },
      {
        heading: 'Parcours',
        items: ['Selectionnez un scenario, lancez la simulation, puis analysez les resultats dans la War Room.'],
      },
    ],
  },
  {
    id: 'drift',
    route: '/drift',
    title: 'Drift Detection',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'La comparaison entre l etat de reference de votre infrastructure et son etat actuel, avec les ajouts, suppressions et modifications detectes.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Identifier les derives non planifiees.',
          'Valider ou ignorer chaque drift.',
          'Declencher un re-scan pour mettre a jour la baseline.',
        ],
      },
      {
        heading: 'Valeur',
        items: [
          'Le drift detection justifie le monitoring continu et garantit que vos plans PRA restent alignes avec la realite du terrain.',
        ],
      },
    ],
  },
  {
    id: 'runbooks',
    route: '/simulations/runbooks',
    title: 'Runbooks',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Les procedures operationnelles de reprise: chaque runbook decrit les etapes a suivre en cas d incident sur un perimetre donne.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Consulter les runbooks generes automatiquement depuis vos scenarios.',
          'Personnaliser les procedures.',
          'Exporter les runbooks et les associer a des exercices.',
        ],
      },
    ],
  },
  {
    id: 'pra-exercises',
    route: '/simulations/pra-exercises',
    title: 'Exercices PRA',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Le planning et l historique des exercices de continuite: planifies, en cours et termines, avec leurs resultats.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Planifier un exercice (type, perimetre, participants, criteres de succes).',
          'Executer un exercice avec suivi en temps reel.',
          'Analyser les resultats et les ecarts par rapport aux objectifs RTO/RPO.',
        ],
      },
    ],
  },
  {
    id: 'incidents',
    route: '/incidents',
    title: 'Incidents',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Le registre des incidents avec leur statut, timeline et impact: declares, en traitement et resolus.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Declarer un nouvel incident en selectionnant visuellement les composants impactes.',
          'Suivre la resolution et consulter l historique.',
          'Relier un incident a un scenario de simulation.',
        ],
      },
    ],
  },
  {
    id: 'documents',
    route: '/documents',
    title: 'Documents',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'L ensemble des documents importes et generes: architecture, politiques de securite, contrats fournisseurs, etc.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Importer de nouveaux documents PDF ou Word.',
          'Lancer l extraction IA pour produire des faits structures reutilisables dans les autres modules.',
        ],
      },
    ],
  },
  {
    id: 'report',
    route: '/report',
    title: 'Rapport PRA/PCA',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'Le generateur de rapport de continuite avec configuration des sections, format cible et niveau de detail.',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Generer un rapport PRA/PCA complet en PDF ou Word.',
          'Choisir les sections a inclure et previsualiser avant export.',
          'Exporter un document qui integre automatiquement toutes les donnees validees (BIA, recommandations, simulations, exercices).',
        ],
      },
    ],
  },
  {
    id: 'knowledge-base',
    route: '/knowledge-base',
    title: 'Knowledge Base',
    sections: [
      {
        heading: 'Ce que vous voyez',
        items: [
          'La base de connaissances Stronghold: articles d aide, guides par module, bonnes pratiques PRA/PCA et references normatives (ISO 22301, DORA).',
        ],
      },
      {
        heading: 'Ce que vous pouvez faire',
        items: [
          'Rechercher un article par sujet.',
          'Consulter le guide d utilisation de chaque module.',
          'Acceder aux references normatives utiles aux audits de conformite.',
        ],
      },
    ],
  },
];

export function resolveGuidedTab(pathname: string): GuidedTabGuide | null {
  const exact = GUIDED_TAB_GUIDES.find((guide) => guide.route === pathname);
  if (exact) return exact;

  return (
    GUIDED_TAB_GUIDES
      .filter((guide) => pathname.startsWith(`${guide.route}/`))
      .sort((a, b) => b.route.length - a.route.length)[0] || null
  );
}

export function buildGuidedTabStorageKey(guide: GuidedTabGuide, tenantScope: string): string {
  return `stronghold:guided-tab:dismissed:${tenantScope}:${guide.id}`;
}
