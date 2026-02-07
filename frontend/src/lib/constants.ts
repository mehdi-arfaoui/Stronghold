export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const RESILIENCE_THRESHOLDS = {
  HIGH: 70,
  MEDIUM: 40,
} as const;

export const RISK_MATRIX_LABELS = {
  impact: ['Negligeable', 'Mineur', 'Modere', 'Majeur', 'Catastrophique'],
  probability: ['Rare', 'Peu probable', 'Possible', 'Probable', 'Quasi-certain'],
} as const;

export const RECOVERY_TIERS = [
  { tier: 1, label: 'Mission Critique', rto: '< 1h', color: 'text-severity-critical' },
  { tier: 2, label: 'Business Critique', rto: '1-4h', color: 'text-severity-high' },
  { tier: 3, label: 'Important', rto: '4-24h', color: 'text-severity-medium' },
  { tier: 4, label: 'Normal', rto: '24-72h', color: 'text-severity-low' },
] as const;

export const SCENARIO_TYPES = [
  { id: 'region_loss', label: 'Perte de region', icon: 'Globe', description: 'Simuler la perte complete d\'une region cloud' },
  { id: 'ransomware', label: 'Attaque Ransomware', icon: 'Lock', description: 'Simuler le chiffrement de donnees par ransomware' },
  { id: 'database_failure', label: 'Panne DB', icon: 'Database', description: 'Simuler la perte d\'une base de donnees critique' },
  { id: 'network_partition', label: 'Partition reseau', icon: 'Unplug', description: 'Simuler une partition reseau entre zones' },
  { id: 'third_party_outage', label: 'Panne service tiers', icon: 'Globe2', description: 'Simuler l\'indisponibilite d\'un service externe' },
  { id: 'dns_failure', label: 'Panne DNS', icon: 'Radio', description: 'Simuler une panne DNS globale' },
  { id: 'custom', label: 'Personnalise', icon: 'Target', description: 'Configurer un scenario sur mesure' },
] as const;

export const PROVIDERS = [
  { id: 'aws', label: 'AWS', description: 'Amazon Web Services' },
  { id: 'azure', label: 'Azure', description: 'Microsoft Azure' },
  { id: 'gcp', label: 'GCP', description: 'Google Cloud Platform' },
  { id: 'kubernetes', label: 'Kubernetes', description: 'Clusters Kubernetes' },
  { id: 'github', label: 'GitHub', description: 'Repositories GitHub' },
  { id: 'network', label: 'Reseau', description: 'Infrastructure reseau on-premise' },
] as const;
