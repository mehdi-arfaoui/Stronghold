import { useMemo } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { knowledgeBaseApi } from '@/api/knowledge-base.api';

const PAGE_TAGS: Record<string, string[]> = {
  '/analysis': ['BIA', 'RTO', 'RPO', 'MTPD'],
  '/recommendations': ['PRA', 'RTO', 'RPO'],
  '/report': ['PRA', 'PCA', 'BIA'],
  '/simulations': ['PRA', 'failover'],
};

export function HelpDrawer() {
  const location = useLocation();
  const tags = useMemo(() => PAGE_TAGS[location.pathname] ?? ['PRA', 'BIA'], [location.pathname]);

  const kbQuery = useQuery({
    queryKey: ['knowledge-base-help', tags.join(',')],
    queryFn: async () => (await knowledgeBaseApi.getAll()).data.articles,
  });

  const relevantArticles = (kbQuery.data ?? []).filter((article) =>
    article.tags.some((tag) => tags.includes(tag))
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed bottom-6 right-6 z-30 rounded-full shadow-lg">❓ Aide</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Articles suggeres</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {relevantArticles.map((article) => (
            <div key={article.id} className="rounded-lg border p-3">
              <p className="font-medium">{article.title}</p>
              <p className="text-sm text-muted-foreground">{article.summary}</p>
              <Link to={`/knowledge-base?term=${encodeURIComponent(article.slug)}`} className="text-xs text-primary underline">
                Ouvrir
              </Link>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
