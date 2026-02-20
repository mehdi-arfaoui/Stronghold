import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { TierSummary } from '@/types/bia.types';
import { formatCurrency } from '@/lib/formatters';

interface TierBreakdownProps {
  tiers: TierSummary[];
  currency: string;
}

const TIER_COLORS = ['border-severity-critical', 'border-severity-high', 'border-severity-medium', 'border-severity-low'];

export function TierBreakdown({ tiers, currency }: TierBreakdownProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
      {tiers.map((tier) => (
        <Card key={tier.tier} className={cn('border-l-4', TIER_COLORS[tier.tier - 1] || 'border-muted')}>
          <CardContent className="p-4">
            <p className="text-sm font-semibold">{tier.label}</p>
            <p className="text-xs text-muted-foreground">RTO {tier.maxRTO}</p>
            <p className="mt-2 text-2xl font-bold">{tier.serviceCount}</p>
            <p className="text-xs text-muted-foreground">services</p>
            {tier.totalFinancialImpact > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Impact: {formatCurrency(tier.totalFinancialImpact, currency)}/h
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
