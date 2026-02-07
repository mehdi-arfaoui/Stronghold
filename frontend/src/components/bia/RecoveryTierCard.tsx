import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';

interface RecoveryTierCardProps {
  tier: number;
  label: string;
  rtoRange: string;
  serviceCount: number;
  financialImpact: number;
}

const TIER_STYLES: Record<number, string> = {
  1: 'border-l-severity-critical',
  2: 'border-l-severity-high',
  3: 'border-l-severity-medium',
  4: 'border-l-severity-low',
};

export function RecoveryTierCard({ tier, label, rtoRange, serviceCount, financialImpact }: RecoveryTierCardProps) {
  return (
    <Card className={cn('border-l-4', TIER_STYLES[tier] || 'border-l-muted')}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">Tier {tier}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{serviceCount}</p>
            <p className="text-xs text-muted-foreground">services</p>
          </div>
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span>RTO {rtoRange}</span>
          {financialImpact > 0 && <span>Impact: {formatCurrency(financialImpact)}/h</span>}
        </div>
      </CardContent>
    </Card>
  );
}
