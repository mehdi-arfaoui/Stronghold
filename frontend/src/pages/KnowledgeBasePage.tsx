import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { knowledgeBaseApi } from '@/api/knowledge-base.api';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function KnowledgeBasePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const kbQuery = useQuery({
    queryKey: ['knowledge-base', search, category],
    queryFn: async () => (await knowledgeBaseApi.getAll({ search, category })).data.articles,
  });

  const articles = kbQuery.data ?? [];
  const categories = useMemo(() => [...new Set(articles.map((a) => a.category))], [articles]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Knowledge Base PCA/PRA/BIA</h1>
      <div className="flex gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value ?? '')} placeholder="Rechercher..." />
        <select
          className="rounded-md border bg-background px-3"
          value={category}
          onChange={(e) => setCategory(e.target.value ?? '')}
        >
          <option value="">Toutes categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3">
        {articles.map((article) => (
          <Card key={article.id}>
            <CardHeader>
              <CardTitle className="text-base">{article.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{article.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {article.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
