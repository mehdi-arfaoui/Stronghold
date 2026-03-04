import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Eye, FlaskConical } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { normalizeLanguage } from '@/i18n/locales';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import type { SPOFItem } from '@/types/analysis.types';

interface SPOFListProps {
  spofs: SPOFItem[];
}

const COPY = {
  fr: {
    title: 'Points uniques de défaillance',
    empty: 'Aucun SPOF détecté',
    top: 'Top SPOF',
    blast: 'Blast radius',
    services: 'services',
  },
  en: {
    title: 'Single points of failure',
    empty: 'No SPOF detected',
    top: 'Top SPOF',
    blast: 'Blast radius',
    services: 'services',
  },
  es: {
    title: 'Puntos únicos de fallo',
    empty: 'No se detectó ningún SPOF',
    top: 'Top SPOF',
    blast: 'Blast radius',
    services: 'servicios',
  },
  it: {
    title: 'Punti singoli di guasto',
    empty: 'Nessun SPOF rilevato',
    top: 'Top SPOF',
    blast: 'Blast radius',
    services: 'servizi',
  },
  zh: {
    title: '单点故障',
    empty: '未检测到 SPOF',
    top: 'Top SPOF',
    blast: 'Blast radius',
    services: '个服务',
  },
} as const;

export function SPOFList({ spofs }: SPOFListProps) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const copy = COPY[normalizeLanguage(i18n.resolvedLanguage)];

  if (spofs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{copy.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-5 w-5 text-severity-critical" />
          {copy.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {spofs.slice(0, 5).map((spof, index) => (
          <div key={spof.nodeId} className="flex items-center gap-3 rounded-lg border p-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-severity-critical/10 text-xs font-bold text-severity-critical">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{spof.nodeName}</p>
              <p className="text-xs text-muted-foreground">
                {copy.blast}: {spof.blastRadius} {copy.services}
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
