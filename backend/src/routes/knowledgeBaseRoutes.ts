import { Router } from 'express';
import { KNOWLEDGE_BASE_ARTICLES, KNOWLEDGE_BASE_CATEGORIES } from '../knowledge-base/data/knowledge-base.js';

const router = Router();

router.get('/', (req, res) => {
  const category = String(req.query.category ?? '').trim();
  const search = String(req.query.search ?? '').trim().toLowerCase();

  const filtered = KNOWLEDGE_BASE_ARTICLES.filter((article) => {
    const matchCategory = !category || article.category === category;
    const matchSearch = !search
      || article.title.toLowerCase().includes(search)
      || article.summary.toLowerCase().includes(search)
      || article.tags.some((tag) => tag.toLowerCase().includes(search))
      || article.content.toLowerCase().includes(search);

    return matchCategory && matchSearch;
  });

  return res.json({ articles: filtered });
});

router.get('/categories', (_req, res) => {
  const counts = KNOWLEDGE_BASE_CATEGORIES.map((cat) => ({
    ...cat,
    count: KNOWLEDGE_BASE_ARTICLES.filter((a) => a.category === cat.id).length,
  }));
  return res.json({ categories: counts });
});

router.get('/article/:slug', (req, res) => {
  const slug = String(req.params.slug ?? '').trim();
  const article = KNOWLEDGE_BASE_ARTICLES.find((item) => item.slug === slug);

  if (!article) {
    return res.status(404).json({ error: `No article found for slug: ${slug}` });
  }

  const related = KNOWLEDGE_BASE_ARTICLES.filter(
    (a) => a.id !== article.id && a.tags.some((tag) => article.tags.includes(tag))
  ).slice(0, 4);

  return res.json({ article, related });
});

router.get('/term/:term', (req, res) => {
  const term = String(req.params.term ?? '').trim().toLowerCase();
  const article = KNOWLEDGE_BASE_ARTICLES.find((item) =>
    item.relatedTerms.some((related) => related.toLowerCase() === term)
    || item.tags.some((tag) => tag.toLowerCase() === term)
    || item.title.toLowerCase().includes(term)
  );

  if (!article) {
    return res.status(404).json({ error: `No knowledge base article for term: ${req.params.term}` });
  }

  return res.json({ article });
});

export default router;
