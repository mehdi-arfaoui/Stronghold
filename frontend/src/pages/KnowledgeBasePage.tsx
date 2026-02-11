import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { knowledgeBaseApi } from '@/api/knowledge-base.api';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';

export function KnowledgeBasePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const kbQuery = useQuery({
    queryKey: ['knowledge-base', search, category === 'all' ? '' : category],
    queryFn: async () => (await knowledgeBaseApi.getAll({ search, category: category === 'all' ? '' : category })).data.articles,
  });

  const articles = kbQuery.data ?? [];
  const categories = useMemo(() => [...new Set((articles ?? []).map((a) => a.category))], [articles]);

  if (kbQuery.isLoading) {
    return <LoadingState message="Chargement de la base de connaissances..." />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Base de connaissances PCA/PRA/BIA</h1>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value ?? '')}
            placeholder="Rechercher un article..."
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Toutes categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes categories</SelectItem>
            {categories.map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {articles.length === 0 && !kbQuery.isLoading && (
        <EmptyState
          icon={BookOpen}
          title="Aucun article trouve"
          description={search ? `Aucun resultat pour "${search}". Essayez un autre terme.` : 'La base de connaissances est vide.'}
        />
      )}

      <div className="grid gap-4">
        {articles.map((article) => (
          <Card key={article.id} className="transition-all duration-200 hover:shadow-md">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base">{article.title}</CardTitle>
                <Badge variant="secondary">{article.category}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{article.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(article.tags ?? []).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
