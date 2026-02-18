import { useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { knowledgeBaseApi } from '@/api/knowledge-base.api';

type HelpContext = {
  label: string;
  slugs: string[];
  tags: string[];
};

const HELP_CONTEXTS: Record<string, HelpContext> = {
  '/dashboard': {
    label: 'Tableau de bord',
    slugs: ['guide-module-tableau-de-bord', 'guide-module-roi-finance', 'modele-maturite-pca'],
    tags: ['guide-module', 'dashboard', 'kpi', 'resilience'],
  },
  '/settings': {
    label: 'Parametres',
    slugs: ['guide-module-parametres', 'roles-gouvernance-pca'],
    tags: ['parametres', 'tenant', 'gouvernance', 'configuration'],
  },
  '/discovery': {
    label: 'Discovery',
    slugs: ['guide-module-decouverte', 'spof-single-point-of-failure', 'haute-disponibilite', 'resilience-cloud'],
    tags: ['guide-module', 'SPOF', 'architecture', 'dependances', 'cloud'],
  },
  '/analysis': {
    label: 'Analysis & BIA',
    slugs: ['guide-module-analyse-bia', 'quest-ce-quun-bia', 'methodologie-bia', 'rto-explique', 'rpo-explique'],
    tags: ['guide-module', 'BIA', 'RTO', 'RPO', 'MTPD'],
  },
  '/business-flows': {
    label: 'Flux Metier',
    slugs: ['guide-module-flux-metier', 'impact-financier-bia', 'guide-module-roi-finance'],
    tags: ['guide-module', 'flux-metier', 'cout-horaire', 'ROI'],
  },
  '/simulations': {
    label: 'Simulations',
    slugs: ['guide-module-simulations', 'exercices-tests-pca', 'exercice-tabletop', 'chaos-engineering'],
    tags: ['guide-module', 'simulation', 'war-room', 'tabletop', 'test'],
  },
  '/simulations/runbooks': {
    label: 'Runbooks',
    slugs: ['guide-module-runbooks', 'strategies-reprise', 'failover-switchover'],
    tags: ['guide-module', 'runbook', 'PRA', 'failover'],
  },
  '/simulations/pra-exercises': {
    label: 'PRA Exercises',
    slugs: ['guide-module-exercices-pra', 'exercices-tests-pca', 'exercice-tabletop'],
    tags: ['guide-module', 'exercices', 'tabletop', 'PRA'],
  },
  '/recommendations': {
    label: 'Recommendations',
    slugs: ['guide-module-recommandations', 'strategies-reprise', 'spof-single-point-of-failure', 'failover-switchover'],
    tags: ['guide-module', 'PRA', 'SPOF', 'failover', 'remediation'],
  },
  '/recommendations/remediation': {
    label: 'Remediation',
    slugs: ['guide-module-recommandations', 'strategies-reprise', 'modele-maturite-pca'],
    tags: ['guide-module', 'remediation', 'actions', 'PRA'],
  },
  '/finance': {
    label: 'ROI & Finance',
    slugs: ['guide-module-roi-finance', 'impact-financier-bia', 'iso-22301-overview'],
    tags: ['guide-module', 'ROI', 'ALE', 'finance', 'BIA'],
  },
  '/drift': {
    label: 'Drift Detection',
    slugs: ['guide-module-drift-detection', 'resilience-cloud', 'analyse-risques-pca'],
    tags: ['guide-module', 'drift', 'ecart', 'conformite'],
  },
  '/report': {
    label: 'Reporting',
    slugs: ['guide-lecture-rapport-pra-pca', 'iso-22301-overview', 'dora-reglement-europeen'],
    tags: ['rapport', 'lecture', 'ISO22301', 'DORA', 'PCA', 'PRA'],
  },
  '/exercises': {
    label: 'Exercises',
    slugs: ['guide-module-exercices-pra', 'exercices-tests-pca', 'exercice-tabletop'],
    tags: ['guide-module', 'exercices', 'tabletop', 'maturite'],
  },
  '/incidents': {
    label: 'Incidents',
    slugs: ['guide-module-incidents', 'communication-de-crise', 'mode-degrade'],
    tags: ['guide-module', 'incident', 'crise', 'PCA'],
  },
  '/documents': {
    label: 'Documents',
    slugs: ['guide-module-documents', 'guide-lecture-rapport-pra-pca'],
    tags: ['guide-module', 'documents', 'preuves', 'audit'],
  },
  '/knowledge-base': {
    label: 'Knowledge Base',
    slugs: ['guide-module-knowledge-base', 'guide-lecture-rapport-pra-pca', 'iso-22301-overview'],
    tags: ['guide-module', 'knowledge-base', 'aide', 'guide'],
  },
};

const DEFAULT_CONTEXT: HelpContext = {
  label: 'Knowledge Base',
  slugs: ['guide-module-knowledge-base', 'quest-ce-quun-bia', 'guide-lecture-rapport-pra-pca'],
  tags: ['guide-module', 'PRA', 'PCA', 'BIA'],
};

function resolveContext(pathname: string): HelpContext {
  const exact = HELP_CONTEXTS[pathname];
  if (exact) return exact;

  const prefixEntry = Object.entries(HELP_CONTEXTS)
    .filter(([key]) => pathname.startsWith(key))
    .sort((a, b) => b[0].length - a[0].length)[0];

  return prefixEntry ? prefixEntry[1] : DEFAULT_CONTEXT;
}

export function HelpDrawer() {
  const location = useLocation();
  const context = useMemo(() => resolveContext(location.pathname), [location.pathname]);

  const kbQuery = useQuery({
    queryKey: ['knowledge-base-help', context.label],
    queryFn: async () => (await knowledgeBaseApi.getAll()).data.articles,
  });

  const relevantArticles = useMemo(() => {
    const articles = kbQuery.data ?? [];

    const curated = context.slugs
      .map((slug) => articles.find((article) => article.slug === slug))
      .filter((article): article is NonNullable<typeof article> => Boolean(article));

    if (curated.length > 0) {
      return curated.slice(0, 6);
    }

    return articles
      .map((article) => ({
        article,
        score: article.tags.filter((tag) => context.tags.includes(tag)).length,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ article }) => article);
  }, [kbQuery.data, context]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed bottom-6 right-6 z-30 gap-1.5 rounded-full shadow-lg" size="sm">
          <BookOpen className="h-4 w-4" />
          Aide
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Articles suggeres</SheetTitle>
          <p className="text-sm text-muted-foreground">Contexte: {context.label}</p>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {relevantArticles.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Aucun article suggere pour cette page.</p>
          )}
          {relevantArticles.map((article) => (
            <div key={article.id} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{article.title}</p>
              <p className="text-xs text-muted-foreground">{article.summary}</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {article.tags.filter((t) => context.tags.includes(t)).slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
                <Link to={`/knowledge-base?article=${encodeURIComponent(article.slug)}`} className="shrink-0 text-xs text-primary underline">
                  Ouvrir
                </Link>
              </div>
            </div>
          ))}
          <div className="border-t pt-2">
            <Link to="/knowledge-base" className="text-sm font-medium text-primary hover:underline">
              Voir toute la base de connaissances
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
