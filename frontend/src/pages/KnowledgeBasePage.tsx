import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import {
  BookOpen,
  Search,
  BarChart3,
  Shield,
  RefreshCw,
  Activity,
  Users,
  FileText,
  Server,
  ClipboardCheck,
  ArrowLeft,
  ExternalLink,
  ChevronRight,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { knowledgeBaseApi, type KnowledgeBaseArticle } from '@/api/knowledge-base.api';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  BIA: BarChart3,
  PCA: Shield,
  PRA: RefreshCw,
  'resilience-metrics': Activity,
  governance: Users,
  regulation: FileText,
  architecture: Server,
  testing: ClipboardCheck,
};

const CATEGORY_COLORS: Record<string, string> = {
  BIA: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  PCA: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  PRA: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  'resilience-metrics': 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  governance: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  regulation: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  architecture: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
  testing: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
};

const CATEGORY_ICON_BG: Record<string, string> = {
  BIA: 'bg-blue-500/15',
  PCA: 'bg-emerald-500/15',
  PRA: 'bg-orange-500/15',
  'resilience-metrics': 'bg-purple-500/15',
  governance: 'bg-amber-500/15',
  regulation: 'bg-red-500/15',
  architecture: 'bg-cyan-500/15',
  testing: 'bg-pink-500/15',
};

const CATEGORY_LABELS: Record<string, string> = {
  BIA: 'Business Impact Analysis',
  PCA: 'Plan de Continuite',
  PRA: 'Plan de Reprise',
  'resilience-metrics': 'Metriques de resilience',
  governance: 'Gouvernance',
  regulation: 'Normes & Reglements',
  architecture: 'Architecture & Resilience',
  testing: 'Tests & Exercices',
};

const CATEGORY_DESC: Record<string, string> = {
  BIA: "Analyse d'impact sur les activites",
  PCA: "Maintenir l'activite en cas de crise",
  PRA: 'Restaurer les services IT apres sinistre',
  'resilience-metrics': 'RTO, RPO, MTPD et indicateurs',
  governance: 'Roles, risques et organisation',
  regulation: 'ISO 22301, DORA, NIST',
  architecture: 'HA, SPOF, cloud et chaos engineering',
  testing: 'Exercices, tabletop et maturite',
};

/** Simple markdown-subset renderer for article content */
function ArticleContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let tableLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushList() {
    if (listItems.length === 0) return;
    const items = listItems.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: inlineMd(item) }} />);
    if (listOrdered) {
      elements.push(<ol key={elements.length} className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">{items}</ol>);
    } else {
      elements.push(<ul key={elements.length} className="list-disc list-inside space-y-1 text-sm text-muted-foreground">{items}</ul>);
    }
    listItems = [];
  }

  function flushTable() {
    if (tableLines.length < 2) { tableLines = []; return; }
    const headerCells = tableLines[0].split('|').map((c) => c.trim()).filter(Boolean);
    const rows = tableLines.slice(2).map((row) => row.split('|').map((c) => c.trim()).filter(Boolean));
    elements.push(
      <div key={elements.length} className="overflow-x-auto my-2">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>{headerCells.map((cell, i) => <th key={i} className="border px-3 py-1.5 text-left font-medium bg-muted/50" dangerouslySetInnerHTML={{ __html: inlineMd(cell) }} />)}</tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="border px-3 py-1.5 text-muted-foreground" dangerouslySetInnerHTML={{ __html: inlineMd(cell) }} />)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableLines = [];
  }

  function inlineMd(text: string): string {
    const html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">$1</code>');

    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['strong', 'code'],
      ALLOWED_ATTR: ['class'],
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table detection
    if (line.includes('|') && line.trim().startsWith('|')) {
      flushList();
      tableLines.push(line);
      continue;
    }
    if (tableLines.length > 0) flushTable();

    // Headers
    if (line.startsWith('### ')) {
      flushList();
      elements.push(<h4 key={elements.length} className="mt-4 mb-1 text-sm font-semibold">{line.slice(4)}</h4>);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      elements.push(<h3 key={elements.length} className="mt-5 mb-2 text-base font-semibold">{line.slice(3)}</h3>);
      continue;
    }

    // Lists
    const unorderedMatch = line.match(/^- (.+)/);
    const orderedMatch = line.match(/^\d+\.\s+(.+)/);
    if (unorderedMatch) {
      if (listOrdered && listItems.length) flushList();
      listOrdered = false;
      listItems.push(unorderedMatch[1]);
      continue;
    }
    if (orderedMatch) {
      if (!listOrdered && listItems.length) flushList();
      listOrdered = true;
      listItems.push(orderedMatch[1]);
      continue;
    }

    flushList();

    // Empty line
    if (line.trim() === '') {
      continue;
    }

    // Paragraph
    elements.push(<p key={elements.length} className="text-sm text-muted-foreground leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineMd(line) }} />);
  }

  flushList();
  flushTable();

  return <div className="space-y-2">{elements}</div>;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timerRef.current);
  }, [value, delayMs]);

  return debouncedValue;
}

export function KnowledgeBasePage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<KnowledgeBaseArticle | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const articleParam = searchParams.get('article');
  const termParam = searchParams.get('term');

  const kbQuery = useQuery({
    queryKey: ['knowledge-base', debouncedSearch, selectedCategory ?? ''],
    queryFn: async () => (await knowledgeBaseApi.getAll({
      search: debouncedSearch,
      category: selectedCategory ?? '',
    })).data.articles,
  });

  const articles = kbQuery.data ?? [];

  // Derive categories and counts from the articles
  const categories = useMemo(() => {
    const allArticlesQuery = search || selectedCategory ? undefined : articles;
    const cats = Object.keys(CATEGORY_LABELS);
    return cats.map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      description: CATEGORY_DESC[id],
      count: allArticlesQuery ? allArticlesQuery.filter((a) => a.category === id).length : 0,
    }));
  }, [articles, search, selectedCategory]);

  const filteredArticles = selectedCategory
    ? articles.filter((a) => a.category === selectedCategory)
    : articles;

  // For article counts in category overview
  const allArticlesQuery = useQuery({
    queryKey: ['knowledge-base-all'],
    queryFn: async () => (await knowledgeBaseApi.getAll()).data.articles,
    staleTime: 60000,
  });
  const allArticles = allArticlesQuery.data ?? [];
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of allArticles) {
      map[a.category] = (map[a.category] ?? 0) + 1;
    }
    return map;
  }, [allArticles]);

  const openArticle = (article: KnowledgeBaseArticle) => {
    setSelectedArticle(article);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('article', article.slug);
    setSearchParams(nextParams, { replace: true });
  };

  const closeArticle = () => {
    setSelectedArticle(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('article');
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (termParam == null) return;
    if (termParam !== search) {
      setSearch(termParam);
      setSelectedCategory(null);
    }
  }, [termParam, search]);

  useEffect(() => {
    if (!articleParam) {
      if (selectedArticle) {
        setSelectedArticle(null);
      }
      return;
    }

    const found = allArticles.find((a) => a.slug === articleParam) ?? articles.find((a) => a.slug === articleParam) ?? null;
    if (found && selectedArticle?.id !== found.id) {
      setSelectedArticle(found);
    }
  }, [articleParam, allArticles, articles, selectedArticle?.id]);

  if (kbQuery.isLoading && !articles.length) {
    return <LoadingState message="Chargement de la base de connaissances..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Base de connaissances</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {allArticles.length} articles sur la continuite d'activite, la reprise et la resilience
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative max-w-lg">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            const value = e.target.value ?? '';
            setSearch(value);
            setSelectedCategory(null);
            const nextParams = new URLSearchParams(searchParams);
            if (value) nextParams.set('term', value);
            else nextParams.delete('term');
            nextParams.delete('article');
            setSearchParams(nextParams, { replace: true });
          }}
          placeholder="Rechercher un article, un terme (RTO, PCA, failover...)"
          className="pl-9"
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => {
              setSearch('');
              const nextParams = new URLSearchParams(searchParams);
              nextParams.delete('term');
              nextParams.delete('article');
              setSearchParams(nextParams, { replace: true });
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Active search results */}
      {search ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {filteredArticles.length} resultat{filteredArticles.length !== 1 ? 's' : ''} pour « {search} »
          </p>
          {filteredArticles.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Aucun article trouve"
              description={`Aucun resultat pour "${search}". Essayez un autre terme.`}
            />
          ) : (
            <div className="grid gap-3">
              {filteredArticles.map((article) => (
                <ArticleCard key={article.id} article={article} onClick={() => openArticle(article)} />
              ))}
            </div>
          )}
        </div>
      ) : selectedCategory ? (
        /* Category drill-down view */
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedCategory(null)} className="gap-1.5 -ml-2">
            <ArrowLeft className="h-4 w-4" />
            Toutes les categories
          </Button>
          <div className="flex items-center gap-3">
            {(() => {
              const Icon = CATEGORY_ICONS[selectedCategory] ?? BookOpen;
              return (
                <div className={`rounded-lg p-2.5 ${CATEGORY_ICON_BG[selectedCategory] ?? 'bg-muted'}`}>
                  <Icon className="h-5 w-5" />
                </div>
              );
            })()}
            <div>
              <h2 className="text-lg font-semibold">{CATEGORY_LABELS[selectedCategory]}</h2>
              <p className="text-sm text-muted-foreground">{CATEGORY_DESC[selectedCategory]}</p>
            </div>
          </div>
          <div className="grid gap-3">
            {filteredArticles.map((article) => (
              <ArticleCard key={article.id} article={article} onClick={() => openArticle(article)} />
            ))}
          </div>
        </div>
      ) : (
        /* Category grid overview */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id] ?? BookOpen;
            const count = categoryCounts[cat.id] ?? 0;
            return (
              <Card
                key={cat.id}
                className="cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30"
                onClick={() => setSelectedCategory(cat.id)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className={`rounded-lg p-2.5 ${CATEGORY_ICON_BG[cat.id] ?? 'bg-muted'}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-xs text-muted-foreground">{count} article{count !== 1 ? 's' : ''}</span>
                  </div>
                  <h3 className="mt-3 font-semibold text-sm">{cat.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{cat.description}</p>
                  <div className="mt-3 flex items-center text-xs text-primary font-medium">
                    Explorer <ChevronRight className="h-3 w-3 ml-0.5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Article detail dialog */}
      <Dialog open={!!selectedArticle} onOpenChange={(open) => { if (!open) closeArticle(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <div className="flex items-start gap-3">
              {selectedArticle && (() => {
                const Icon = CATEGORY_ICONS[selectedArticle.category] ?? BookOpen;
                return (
                  <div className={`rounded-lg p-2 shrink-0 ${CATEGORY_ICON_BG[selectedArticle.category] ?? 'bg-muted'}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                );
              })()}
              <div className="min-w-0">
                <DialogTitle className="text-lg leading-snug">{selectedArticle?.title}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">{selectedArticle?.summary}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {selectedArticle && (
                <Badge className={`text-xs ${CATEGORY_COLORS[selectedArticle.category] ?? ''}`}>
                  {CATEGORY_LABELS[selectedArticle.category] ?? selectedArticle.category}
                </Badge>
              )}
              {selectedArticle?.source && (
                <Badge variant="outline" className="text-xs gap-1">
                  <ExternalLink className="h-3 w-3" />
                  {selectedArticle.source}
                </Badge>
              )}
            </div>
          </DialogHeader>
          <Separator />
          <ScrollArea className="px-6 py-4 max-h-[55vh]">
            {selectedArticle && <ArticleContent content={selectedArticle.content} />}
            {selectedArticle && selectedArticle.tags.length > 0 && (
              <div className="mt-6 pt-4 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedArticle.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs cursor-pointer" onClick={() => {
                      setSearch(tag);
                      setSelectedCategory(null);
                      closeArticle();
                      const nextParams = new URLSearchParams(searchParams);
                      nextParams.set('term', tag);
                      nextParams.delete('article');
                      setSearchParams(nextParams, { replace: true });
                    }}>
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArticleCard({ article, onClick }: { article: KnowledgeBaseArticle; onClick: () => void }) {
  const Icon = CATEGORY_ICONS[article.category] ?? BookOpen;
  return (
    <Card
      className="cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/30"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`rounded-md p-1.5 shrink-0 ${CATEGORY_ICON_BG[article.category] ?? 'bg-muted'}`}>
              <Icon className="h-4 w-4" />
            </div>
            <CardTitle className="text-sm leading-snug">{article.title}</CardTitle>
          </div>
          <Badge className={`shrink-0 text-xs ${CATEGORY_COLORS[article.category] ?? ''}`}>
            {CATEGORY_LABELS[article.category] ?? article.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground ml-9">{article.summary}</p>
        <div className="mt-2 ml-9 flex flex-wrap gap-1">
          {article.tags.slice(0, 4).map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)}
          {article.tags.length > 4 && <span className="text-xs text-muted-foreground self-center">+{article.tags.length - 4}</span>}
        </div>
      </CardContent>
    </Card>
  );
}







