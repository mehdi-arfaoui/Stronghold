// ============================================================
// Cloud Recovery Strategy Costs — Estimates based on public pricing
// ============================================================

export const RECOVERY_STRATEGY_COSTS = {
  'active-active': {
    label: 'Active-Active (multi-region)',
    description: 'Infrastructure dupliquee dans 2+ regions. RTO < 5min, RPO ~ 0.',
    costMultiplier: 1.8,
    rtoRange: { min: 0, max: 5, unit: 'minutes' as const },
    rpoRange: { min: 0, max: 1, unit: 'minutes' as const },
    bestFor: ['Services de paiement', 'API critiques', 'Bases de donnees transactionnelles'],
    cloudCosts: {
      aws: { monthly: { min: 800, max: 3000 }, description: 'Multi-AZ RDS + Global Accelerator + Route53 failover' },
      azure: { monthly: { min: 700, max: 2800 }, description: 'Cosmos DB multi-region + Traffic Manager + AG' },
      gcp: { monthly: { min: 750, max: 2500 }, description: 'Spanner multi-region + Cloud CDN + GCLB' },
    },
    source: 'Estimations basees sur les prix publics AWS/Azure/GCP (jan 2025)',
  },

  'warm-standby': {
    label: 'Warm Standby',
    description: 'Infra reduite dans la region secondaire, scaling up en cas de basculement.',
    costMultiplier: 0.4,
    rtoRange: { min: 10, max: 30, unit: 'minutes' as const },
    rpoRange: { min: 1, max: 15, unit: 'minutes' as const },
    bestFor: ['Services backend', 'APIs non-critiques', 'Services internes'],
    cloudCosts: {
      aws: { monthly: { min: 200, max: 800 }, description: 'ASG min=1, read replica async, S3 cross-region' },
      azure: { monthly: { min: 180, max: 700 }, description: 'VMSS min=1, geo-replication async, Blob replication' },
      gcp: { monthly: { min: 190, max: 750 }, description: 'MIG min=1, Cloud SQL read replica, GCS multi-region' },
    },
    source: 'Estimations basees sur les prix publics AWS/Azure/GCP (jan 2025)',
  },

  'pilot-light': {
    label: 'Pilot Light',
    description: 'Seules les donnees sont repliquees. Le compute est provisionne au basculement.',
    costMultiplier: 0.15,
    rtoRange: { min: 30, max: 120, unit: 'minutes' as const },
    rpoRange: { min: 5, max: 60, unit: 'minutes' as const },
    bestFor: ['Services de reporting', 'Batch processing', 'Services analytiques'],
    cloudCosts: {
      aws: { monthly: { min: 50, max: 300 }, description: 'RDS read replica + AMIs + Launch templates' },
      azure: { monthly: { min: 45, max: 250 }, description: 'SQL geo-replication + VM images + ARM templates' },
      gcp: { monthly: { min: 50, max: 280 }, description: 'Cloud SQL replica + Machine images + Deployment Manager' },
    },
    source: 'Estimations basees sur les prix publics AWS/Azure/GCP (jan 2025)',
  },

  backup: {
    label: 'Backup & Restore',
    description: 'Sauvegardes regulieres. Reconstruction complete au basculement.',
    costMultiplier: 0.05,
    rtoRange: { min: 120, max: 1440, unit: 'minutes' as const },
    rpoRange: { min: 60, max: 1440, unit: 'minutes' as const },
    bestFor: ['Environnements de dev/staging', 'Archives', 'Services non-critiques'],
    cloudCosts: {
      aws: { monthly: { min: 10, max: 100 }, description: 'S3 IA/Glacier + AWS Backup + snapshots EBS' },
      azure: { monthly: { min: 10, max: 90 }, description: 'Azure Backup + Blob cool/archive tier' },
      gcp: { monthly: { min: 10, max: 95 }, description: 'Cloud Storage Nearline/Coldline + snapshots' },
    },
    source: 'Estimations basees sur les prix publics AWS/Azure/GCP (jan 2025)',
  },
} as const;

export type RecoveryStrategyKey = keyof typeof RECOVERY_STRATEGY_COSTS;

export function getStrategyCost(strategy: RecoveryStrategyKey, provider: 'aws' | 'azure' | 'gcp' = 'aws') {
  const s = RECOVERY_STRATEGY_COSTS[strategy];
  const cloud = s.cloudCosts[provider];
  return {
    label: s.label,
    monthlyMin: cloud.monthly.min,
    monthlyMax: cloud.monthly.max,
    monthlyMedian: Math.round((cloud.monthly.min + cloud.monthly.max) / 2),
    costMultiplier: s.costMultiplier,
    rtoRange: s.rtoRange,
    rpoRange: s.rpoRange,
    description: cloud.description,
    source: s.source,
  };
}

export function estimateRecoveryCost(
  strategy: RecoveryStrategyKey,
  currentMonthlyCost: number,
  provider: 'aws' | 'azure' | 'gcp' = 'aws',
): { monthlyCost: number; annualCost: number; source: string } {
  const s = RECOVERY_STRATEGY_COSTS[strategy];
  const cloud = s.cloudCosts[provider];
  const estimatedMonthly = Math.max(cloud.monthly.min, currentMonthlyCost * s.costMultiplier);
  return {
    monthlyCost: Math.round(estimatedMonthly),
    annualCost: Math.round(estimatedMonthly * 12),
    source: s.source,
  };
}
