import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Eye, FlaskConical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import type { SPOFItem } from '@/types/analysis.types';

interface SPOFListProps {
  spofs: SPOFItem[];
}

export function SPOFList({ spofs }: SPOFListProps) {
  const navigate = useNavigate();

  if (spofs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Points uniques de defaillance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Aucun SPOF detecte</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-5 w-5 text-severity-critical" />
          Top SPOF
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {spofs.slice(0, 5).map((spof, i) => (
          <div key={spof.nodeId} className="flex items-center gap-3 rounded-lg border p-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-severity-critical/10 text-xs font-bold text-severity-critical">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{spof.nodeName}</p>
              <p className="text-xs text-muted-foreground">
                Blast radius: {spof.blastRadius} services
              </p>
            </div>
            <SeverityBadge severity={spof.severity} />
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate(`/discovery?node=${spof.nodeId}`)}
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigate(`/simulations?node=${spof.nodeId}`)}
              >
                <FlaskConical className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
