import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { normalizeLanguage } from '@/i18n/locales';
import { cn } from '@/lib/utils';
import type { Severity } from '@/types/common.types';

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

const LABELS: Record<string, Record<Severity, string>> = {
  fr: { critical: 'Critique', high: 'Élevé', medium: 'Moyen', low: 'Faible' },
  en: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
  es: { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' },
  it: { critical: 'Critico', high: 'Alto', medium: 'Medio', low: 'Basso' },
  zh: { critical: '严重', high: '高', medium: '中', low: '低' },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const { i18n } = useTranslation();
  const labels = LABELS[normalizeLanguage(i18n.resolvedLanguage)];

  return (
    <Badge
      variant="outline"
      className={cn(
        severity === 'critical' && 'border-severity-critical bg-severity-critical/10 text-severity-critical',
        severity === 'high' && 'border-severity-high bg-severity-high/10 text-severity-high',
        severity === 'medium' && 'border-severity-medium bg-severity-medium/10 text-severity-medium',
        severity === 'low' && 'border-severity-low bg-severity-low/10 text-severity-low',
        className,
      )}
    >
      {labels[severity]}
    </Badge>
  );
}
