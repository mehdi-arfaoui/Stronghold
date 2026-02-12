import { useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { knowledgeBaseApi } from '@/api/knowledge-base.api';

const PAGE_TAGS: Record<string, string[]> = {
  '/analysis': ['BIA', 'RTO', 'RPO', 'MTPD', 'MBCO', 'WRT'],
  '/recommendations': ['PRA', 'RTO', 'RPO', 'SPOF', 'redundance'],
  '/report': ['PRA', 'PCA', 'BIA', 'ISO22301', 'DORA'],
  '/simulations': ['PRA', 'failover', 'chaos-engineering', 'test'],
  '/exercises': ['exercices', 'tabletop', 'PCA', 'PRA'],
  '/incidents': ['PRA', 'ransomware', 'incident', 'crise'],
  '/discovery': ['SPOF', 'architecture', 'redundance', 'HA'],
  '/dashboard': ['BIA', 'PCA', 'resilience', 'maturite'],
  '/documents': ['PCA', 'PRA', 'gouvernance', 'ISO22301'],
};

export function HelpDrawer() {
  const location = useLocation();
  const tags = useMemo(() => PAGE_TAGS[location.pathname] ?? ['PRA', 'BIA', 'PCA'], [location.pathname]);

  const kbQuery = useQuery({
    queryKey: ['knowledge-base-help', tags.join(',')],
    queryFn: async () => (await knowledgeBaseApi.getAll()).data.articles,
  });

  const relevantArticles = useMemo(() =>
    (kbQuery.data ?? [])
      .map((article) => ({
        article,
        score: article.tags.filter((tag) => tags.includes(tag)).length,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ article }) => article),
    [kbQuery.data, tags]
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed bottom-6 right-6 z-30 rounded-full shadow-lg gap-1.5" size="sm">
          <BookOpen className="h-4 w-4" />
          Aide
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Articles suggeres</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Contenu pertinent pour cette page
          </p>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {relevantArticles.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Aucun article suggere pour cette page.</p>
          )}
          {relevantArticles.map((article) => (
            <div key={article.id} className="rounded-lg border p-3 space-y-2">
              <p className="font-medium text-sm">{article.title}</p>
              <p className="text-xs text-muted-foreground">{article.summary}</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {article.tags.filter((t) => tags.includes(t)).slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
                <Link to="/knowledge-base" className="text-xs text-primary underline shrink-0">
                  Ouvrir
                </Link>
              </div>
            </div>
          ))}
          <div className="pt-2 border-t">
            <Link to="/knowledge-base" className="text-sm text-primary font-medium hover:underline">
              Voir toute la base de connaissances
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
