import { api } from "./client";

export type ComplianceFrameworkId = "iso22301" | "nis2";
export type ComplianceStatus = "compliant" | "partial" | "non_compliant" | "unavailable";

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
  frameworkId: ComplianceFrameworkId;
  frameworkName: string;
  frameworkVersion: string;
  overallScore: number;
  totalPoints: number;
  maxPoints: number;
  checks: ComplianceCheck[];
  generatedAt: string;
  disclaimer: string;
}

export const complianceApi = {
  getReport: (framework: ComplianceFrameworkId) =>
    api.get<ComplianceReport>(`/compliance/${framework}`),
};
