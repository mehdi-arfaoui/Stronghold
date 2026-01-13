export type EvidenceKey = "bia" | "risks" | "runbooks" | "exercises";

export type IsoRequirement = {
  id: string;
  text: string;
  evidence: EvidenceKey;
};

export type IsoChapter = {
  id: string;
  title: string;
  requirements: IsoRequirement[];
};

type SecNumCloudDomain = {
  label: string;
  evidence: EvidenceKey;
};

const ISO_22301_CHAPTERS: IsoChapter[] = [
  {
    id: "4",
    title: "Contexte de l'organisation",
    requirements: [
      {
        id: "4.1",
        text: "Comprendre l'organisation et son contexte",
        evidence: "bia",
      },
      {
        id: "4.2",
        text: "Comprendre les besoins et attentes des parties intéressées",
        evidence: "bia",
      },
      {
        id: "4.3",
        text: "Déterminer le périmètre du SMSI/SMS de continuité",
        evidence: "bia",
      },
      {
        id: "4.4",
        text: "Établir, mettre en œuvre et maintenir le SMS de continuité",
        evidence: "runbooks",
      },
    ],
  },
  {
    id: "5",
    title: "Leadership",
    requirements: [
      {
        id: "5.1",
        text: "Leadership et engagement de la direction",
        evidence: "runbooks",
      },
      {
        id: "5.2",
        text: "Politique de continuité des activités",
        evidence: "runbooks",
      },
      {
        id: "5.3",
        text: "Rôles, responsabilités et autorités",
        evidence: "runbooks",
      },
    ],
  },
  {
    id: "6",
    title: "Planification",
    requirements: [
      {
        id: "6.1",
        text: "Actions pour traiter les risques et opportunités",
        evidence: "risks",
      },
      {
        id: "6.2",
        text: "Objectifs de continuité et planification pour les atteindre",
        evidence: "bia",
      },
      {
        id: "6.3",
        text: "Planification des changements",
        evidence: "runbooks",
      },
    ],
  },
  {
    id: "7",
    title: "Support",
    requirements: [
      {
        id: "7.2",
        text: "Compétences nécessaires pour les activités de continuité",
        evidence: "runbooks",
      },
      {
        id: "7.4",
        text: "Communication interne et externe",
        evidence: "runbooks",
      },
      {
        id: "7.5",
        text: "Informations documentées",
        evidence: "runbooks",
      },
    ],
  },
  {
    id: "8",
    title: "Fonctionnement",
    requirements: [
      {
        id: "8.2",
        text: "Analyse d'impact et évaluation des risques",
        evidence: "bia",
      },
      {
        id: "8.3",
        text: "Stratégies et solutions de continuité",
        evidence: "runbooks",
      },
      {
        id: "8.4",
        text: "Plans et procédures de continuité",
        evidence: "runbooks",
      },
      {
        id: "8.5",
        text: "Programme d'exercices et de tests",
        evidence: "exercises",
      },
    ],
  },
  {
    id: "9",
    title: "Évaluation des performances",
    requirements: [
      {
        id: "9.1",
        text: "Surveillance, mesure, analyse et évaluation",
        evidence: "exercises",
      },
      {
        id: "9.2",
        text: "Audit interne",
        evidence: "exercises",
      },
      {
        id: "9.3",
        text: "Revue de direction",
        evidence: "risks",
      },
    ],
  },
  {
    id: "10",
    title: "Amélioration",
    requirements: [
      {
        id: "10.1",
        text: "Non-conformité et action corrective",
        evidence: "risks",
      },
      {
        id: "10.2",
        text: "Amélioration continue",
        evidence: "runbooks",
      },
    ],
  },
];

const SECNUMCLOUD_DOMAINS: SecNumCloudDomain[] = [
  { label: "Gouvernance", evidence: "risks" },
  { label: "Gestion des risques", evidence: "risks" },
  { label: "Continuité & PRA", evidence: "runbooks" },
  { label: "Sécurité opérationnelle", evidence: "runbooks" },
  { label: "Protection des données", evidence: "runbooks" },
  { label: "Tests & exercices", evidence: "exercises" },
];

const SECNUMCLOUD_CRITERIA = Array.from({ length: 360 }, (_, index) => {
  const position = index + 1;
  const domain = SECNUMCLOUD_DOMAINS[index % SECNUMCLOUD_DOMAINS.length];
  const id = `SNC-${String(position).padStart(3, "0")}`;
  return {
    id,
    label: `Critère SecNumCloud ${id}`,
    domain: domain.label,
    evidence: domain.evidence,
  };
});

export const COMPLIANCE_REFERENTIAL = {
  iso22301: {
    standard: "ISO 22301:2019",
    chapters: ISO_22301_CHAPTERS,
  },
  secNumCloud: {
    standard: "SecNumCloud",
    totalCriteria: SECNUMCLOUD_CRITERIA.length,
    domains: SECNUMCLOUD_DOMAINS,
    criteria: SECNUMCLOUD_CRITERIA,
  },
} as const;
