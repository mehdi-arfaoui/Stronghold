import { Lock } from 'lucide-react';

type UpgradePromptProps = {
  feature: string;
  requiredPlan: string;
};

export function UpgradePrompt({ feature, requiredPlan }: UpgradePromptProps) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-amber-950 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-200/80 p-2">
          <Lock className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{feature}</p>
          <p className="text-sm text-amber-900">
            Cette fonctionnalite est disponible avec le plan {requiredPlan}. Contactez
            {' '}support@stronghold.io.
          </p>
        </div>
      </div>
    </div>
  );
}
