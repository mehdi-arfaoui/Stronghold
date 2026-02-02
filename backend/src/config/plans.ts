export const PLANS = {
  STARTER: {
    name: 'Starter',
    maxUsers: 5,
    maxStorage: 1 * 1024 * 1024 * 1024,      // 1 GB
    maxScansMonth: 100,
    maxDocuments: 500,
    features: ['discovery', 'inventory', 'basic_reports'],
    price: 0,
  },
  PRO: {
    name: 'Pro',
    maxUsers: 25,
    maxStorage: 10 * 1024 * 1024 * 1024,     // 10 GB
    maxScansMonth: 1000,
    maxDocuments: 5000,
    features: [
      'discovery',
      'inventory',
      'bia',
      'pra',
      'reports',
      'exports',
      'api_access'
    ],
    price: 299,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    maxUsers: -1,                             // Illimité
    maxStorage: 100 * 1024 * 1024 * 1024,    // 100 GB
    maxScansMonth: -1,                        // Illimité
    maxDocuments: -1,                         // Illimité
    features: ['*'],                          // Toutes
    price: null,                              // Sur devis
  },
  CUSTOM: {
    name: 'Custom',
    maxUsers: -1,
    maxStorage: -1,
    maxScansMonth: -1,
    maxDocuments: -1,
    features: ['*'],
    price: null,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export const FEATURE_REGISTRY = {
  discovery: { name: 'Discovery', description: 'Scan réseau et cloud' },
  inventory: { name: 'Inventaire', description: 'Gestion des assets' },
  basic_reports: { name: 'Rapports basiques', description: 'Export PDF simple' },
  bia: { name: 'Analyse BIA', description: 'Business Impact Analysis' },
  pra: { name: 'Plan PRA', description: 'Plan de Reprise d\'Activité' },
  reports: { name: 'Rapports avancés', description: 'Tous les templates' },
  exports: { name: 'Exports', description: 'Export Excel, CSV, JSON' },
  api_access: { name: 'Accès API', description: 'API REST complète' },
  exercises: { name: 'Exercices', description: 'Simulations de crise' },
  white_label: { name: 'White Label', description: 'Personnalisation marque' },
} as const;

export type FeatureKey = keyof typeof FEATURE_REGISTRY;
