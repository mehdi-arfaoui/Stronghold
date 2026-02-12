// ============================================================
// Compliance Mapping — Tags for recommendations, BIA, reports
// ============================================================

export const COMPLIANCE_TAGS = {
  iso22301: {
    name: 'ISO 22301',
    fullName: 'ISO 22301:2019 — Securite et resilience — Systemes de management de la continuite d\'activite',
    clauses: {
      '8.2.2': { title: 'Business Impact Analysis', applicableTo: ['bia_auto_generate', 'bia_rto_rpo'] },
      '8.2.3': { title: 'Risk Assessment', applicableTo: ['risk_detection', 'spof_analysis'] },
      '8.3': { title: 'Business Continuity Strategies', applicableTo: ['recommendations', 'recovery_strategy'] },
      '8.4': { title: 'Business Continuity Plans', applicableTo: ['report_pra_pca'] },
      '8.5': { title: 'Exercise Programme', applicableTo: ['exercises', 'simulations'] },
    },
  },

  dora: {
    name: 'DORA',
    fullName: 'Digital Operational Resilience Act (UE) 2022/2554',
    clauses: {
      'Art. 6': { title: 'ICT Risk Management Framework', applicableTo: ['risk_detection', 'spof_analysis'] },
      'Art. 8': { title: 'Identification of ICT risks', applicableTo: ['discovery', 'graph_analysis'] },
      'Art. 9': { title: 'Protection and Prevention', applicableTo: ['recommendations'] },
      'Art. 10': { title: 'Detection', applicableTo: ['drift_detection', 'monitoring'] },
      'Art. 11': { title: 'Response and Recovery', applicableTo: ['simulations', 'war_room', 'report_pra_pca'] },
      'Art. 12': { title: 'Backup policies and recovery', applicableTo: ['bia_rto_rpo', 'recovery_strategy'] },
      'Art. 24': { title: 'TLPT — Threat Led Penetration Testing', applicableTo: ['exercises', 'simulations'] },
      'Art. 26': { title: 'ICT Third-Party Risk', applicableTo: ['dependency_graph', 'vendor_analysis'] },
    },
  },

  nis2: {
    name: 'NIS2',
    fullName: 'Directive NIS2 (UE) 2022/2555',
    clauses: {
      'Art. 21.2.c': { title: 'Business continuity and crisis management', applicableTo: ['report_pra_pca', 'exercises'] },
      'Art. 21.2.d': { title: 'Supply chain security', applicableTo: ['dependency_graph', 'vendor_analysis'] },
      'Art. 23': { title: 'Reporting obligations', applicableTo: ['drift_detection', 'incident_management'] },
    },
  },
} as const;

export type ComplianceFramework = keyof typeof COMPLIANCE_TAGS;

export interface ComplianceTag {
  framework: string;
  clause: string;
  title: string;
}

/**
 * Get compliance tags for a given feature/capability
 */
export function getComplianceTags(featureKey: string): ComplianceTag[] {
  const tags: ComplianceTag[] = [];

  for (const [frameworkKey, framework] of Object.entries(COMPLIANCE_TAGS)) {
    for (const [clauseKey, clause] of Object.entries(framework.clauses)) {
      if ((clause as any).applicableTo.includes(featureKey)) {
        tags.push({
          framework: framework.name,
          clause: clauseKey,
          title: (clause as any).title,
        });
      }
    }
  }

  return tags;
}

/**
 * Calculate compliance coverage for a set of implemented features
 */
export function calculateComplianceCoverage(implementedFeatures: string[]): Record<string, { total: number; covered: number; percentage: number }> {
  const result: Record<string, { total: number; covered: number; percentage: number }> = {};

  for (const [frameworkKey, framework] of Object.entries(COMPLIANCE_TAGS)) {
    const clauses = Object.values(framework.clauses);
    const total = clauses.length;
    const covered = clauses.filter(clause =>
      (clause as any).applicableTo.some((feature: string) => implementedFeatures.includes(feature))
    ).length;

    result[framework.name] = {
      total,
      covered,
      percentage: total > 0 ? Math.round((covered / total) * 100) : 0,
    };
  }

  return result;
}
