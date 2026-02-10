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
}

export const knowledgeBaseApi = {
  getAll: (params?: { search?: string; category?: string }) =>
    api.get<{ articles: KnowledgeBaseArticle[] }>('/knowledge-base', { params }),
  getByTerm: (term: string) =>
    api.get<{ article: KnowledgeBaseArticle }>(`/knowledge-base/term/${encodeURIComponent(term)}`),
};
