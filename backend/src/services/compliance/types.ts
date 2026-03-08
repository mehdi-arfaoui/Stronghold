export type ComplianceStatus = "compliant" | "partial" | "non_compliant" | "unavailable";

export interface ComplianceFrameworkRequirement {
  id: string;
  clause: string;
  title: string;
  description: string;
  dataSource: string;
  check: string;
  weight: number;
}

export interface ComplianceFramework {
  id: string;
  name: string;
  description: string;
  version?: string;
  requirements: ComplianceFrameworkRequirement[];
}

export interface ComplianceCheck {
  requirementId: string;
  clause: string;
  title: string;
  description: string;
  status: ComplianceStatus;
  score: number;
  maxScore: number;
  details: string;
  actionUrl?: string;
}

export interface ComplianceReport {
  frameworkId: string;
  frameworkName: string;
  frameworkVersion: string;
  overallScore: number;
  totalPoints: number;
  maxPoints: number;
  checks: ComplianceCheck[];
  generatedAt: string;
  disclaimer: string;
}

export interface ComplianceCheckResult {
  status: ComplianceStatus;
  details: string;
}

export interface ComplianceFrameworkSummary {
  id: string;
  name: string;
  score: number;
  compliant: number;
  partial: number;
  nonCompliant: number;
  unavailable: number;
}
