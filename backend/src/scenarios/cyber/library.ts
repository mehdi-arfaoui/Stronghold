export type CyberScenario = {
  id: string;
  name: string;
  description: string;
  incidentSteps: string[];
  impacts: string[];
  detection: string[];
  responseActions: string[];
  recoveryPlan: string[];
  defaultDurationHours: number;
  tags: string[];
};

export const CYBER_SCENARIOS: CyberScenario[] = [
  {
    id: "ransomware",
    name: "Ransomware",
    description:
      "Chiffrement des données critiques avec demande de rançon et indisponibilité des services clés.",
    incidentSteps: [
      "Phishing ou exploitation initiale d'une vulnérabilité.",
      "Exécution du payload et élévation de privilèges.",
      "Propagation latérale vers serveurs et postes de travail.",
      "Chiffrement massif des fichiers et perturbation des sauvegardes.",
      "Affichage de la note de rançon et interruption opérationnelle.",
    ],
    impacts: [
      "Indisponibilité des applications métier.",
      "Perte de productivité et arrêt de production.",
      "Exposition réglementaire et réputationnelle.",
    ],
    detection: [
      "Alertes EDR sur comportements de chiffrement.",
      "Pics d'accès fichiers anormaux sur partages.",
      "Détections SIEM sur escalades de privilèges.",
    ],
    responseActions: [
      "Isoler immédiatement les hôtes compromis.",
      "Désactiver les comptes impactés et forcer la rotation des mots de passe.",
      "Bloquer les flux réseau vers les IOC identifiés.",
      "Activer le plan de continuité et les communications de crise.",
    ],
    recoveryPlan: [
      "Restaurer les sauvegardes hors ligne vérifiées.",
      "Rebuild des environnements critiques et validation applicative.",
      "Revue post-incident et renforcement des contrôles.",
    ],
    defaultDurationHours: 6,
    tags: ["malware", "critical", "data"],
  },
  {
    id: "ddos",
    name: "DDoS",
    description:
      "Saturation des services exposés par un trafic volumétrique ou applicatif.",
    incidentSteps: [
      "Montée en charge anormale sur les points d'entrée publics.",
      "Saturation des capacités réseau ou des équilibreurs.",
      "Dégradation progressive des SLA et erreurs applicatives.",
      "Blocage partiel ou total des services en ligne.",
    ],
    impacts: [
      "Indisponibilité des services exposés.",
      "Perte de chiffre d'affaires et insatisfaction client.",
      "Surconsommation de ressources cloud.",
    ],
    detection: [
      "Alertes WAF/CDN sur volumes de requêtes.",
      "Surveillance NOC et dashboards de latence.",
      "Pics inhabituels sur les métriques d'entrée/sortie.",
    ],
    responseActions: [
      "Activer les protections anti-DDoS en amont.",
      "Mettre en place un rate-limiting et des règles WAF.",
      "Communiquer avec le fournisseur réseau et le SOC.",
    ],
    recoveryPlan: [
      "Basculer vers des capacités supplémentaires temporaires.",
      "Revenir à une configuration standard après stabilisation.",
      "Documenter les enseignements et ajuster les seuils.",
    ],
    defaultDurationHours: 4,
    tags: ["availability", "network"],
  },
  {
    id: "credential-compromise",
    name: "Compromis d'identifiants",
    description:
      "Prise de contrôle d'identifiants sensibles entraînant des accès non autorisés.",
    incidentSteps: [
      "Collecte d'identifiants via phishing ou fuite.",
      "Connexion suspecte et évasion des contrôles MFA.",
      "Élévation de privilèges et accès aux données.",
      "Exfiltration ou manipulation de données critiques.",
    ],
    impacts: [
      "Accès non autorisé aux données sensibles.",
      "Risque de fraude ou de manipulation des transactions.",
      "Perturbation des opérations internes.",
    ],
    detection: [
      "Alertes IAM sur connexions inhabituelles.",
      "Écarts de localisation ou d'horaires anormaux.",
      "Anomalies sur les privilèges administratifs.",
    ],
    responseActions: [
      "Désactiver immédiatement les comptes compromis.",
      "Réinitialiser les accès et renforcer la MFA.",
      "Inspecter les journaux et isoler les sessions actives.",
    ],
    recoveryPlan: [
      "Révoquer les tokens actifs et surveiller les accès.",
      "Réviser les droits d'accès et appliquer le moindre privilège.",
      "Informer les parties prenantes et documenter l'incident.",
    ],
    defaultDurationHours: 3,
    tags: ["identity", "access"],
  },
  {
    id: "vm-destruction",
    name: "Destruction de VM",
    description:
      "Suppression ou corruption de machines virtuelles critiques dans l'infrastructure.",
    incidentSteps: [
      "Accès non autorisé aux consoles d'administration.",
      "Suppression ou arrêt forcé des VMs critiques.",
      "Propagation de la perte vers les environnements dépendants.",
      "Interruption de service et perte de données volatiles.",
    ],
    impacts: [
      "Interruption des applications hébergées.",
      "Perte de données non sauvegardées.",
      "Ralentissement des opérations de reprise.",
    ],
    detection: [
      "Alertes d'audit sur actions d'administration.",
      "Monitoring infra sur crash de VMs.",
      "Logs d'orchestration indiquant une suppression.",
    ],
    responseActions: [
      "Bloquer les comptes d'administration compromis.",
      "Isoler le plan de gestion et activer les procédures d'urgence.",
      "Coordonner avec l'équipe infra pour stopper l'impact.",
    ],
    recoveryPlan: [
      "Restaurer les VMs à partir des images validées.",
      "Reconfigurer les dépendances réseau et stockage.",
      "Renforcer les contrôles d'accès et l'immutabilité.",
    ],
    defaultDurationHours: 5,
    tags: ["infrastructure", "resilience"],
  },
];

export function getCyberScenarioById(id: string) {
  return CYBER_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
