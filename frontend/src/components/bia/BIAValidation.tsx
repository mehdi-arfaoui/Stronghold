import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface BIAValidationProps {
  totalServices: number;
  validatedCount: number;
}

export function BIAValidation({ totalServices, validatedCount }: BIAValidationProps) {
  const percentage = totalServices > 0 ? (validatedCount / totalServices) * 100 : 0;
  const isComplete = validatedCount === totalServices;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {isComplete ? (
            <CheckCircle2 className="h-5 w-5 text-resilience-high" />
          ) : percentage > 0 ? (
            <AlertCircle className="h-5 w-5 text-severity-medium" />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground" />
          )}
          Validation BIA
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{validatedCount}/{totalServices} services validés</span>
            <span className="font-medium">{Math.round(percentage)}%</span>
          </div>
          <Progress value={percentage} className="h-2" />
          {!isComplete && (
            <p className="text-xs text-muted-foreground">
              Validez chaque ligne du BIA pour confirmer les valeurs RTO/RPO suggérées ou les ajuster.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
