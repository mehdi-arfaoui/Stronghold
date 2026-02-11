import { api } from './client';

export interface KnowledgeBaseArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  summary: string;
  content: string;
  relatedTerms: string[];
  source: string;
  icon?: string;
}

export interface KnowledgeBaseCategory {
  id: string;
  label: string;
  description: string;
  icon: string;
  count: number;
}

export const knowledgeBaseApi = {
  getAll: (params?: { search?: string; category?: string }) =>
    api.get<{ articles: KnowledgeBaseArticle[] }>('/knowledge-base', { params }),
  getCategories: () =>
    api.get<{ categories: KnowledgeBaseCategory[] }>('/knowledge-base/categories'),
  getBySlug: (slug: string) =>
    api.get<{ article: KnowledgeBaseArticle; related: KnowledgeBaseArticle[] }>(`/knowledge-base/article/${encodeURIComponent(slug)}`),
  getByTerm: (term: string) =>
    api.get<{ article: KnowledgeBaseArticle }>(`/knowledge-base/term/${encodeURIComponent(term)}`),
};
