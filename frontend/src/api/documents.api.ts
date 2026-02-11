import { api } from './client';

export interface Document {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  status: 'processing' | 'ready' | 'error';
  extractedFacts?: number;
}

export const documentsApi = {
  getAll: () =>
    api.get<Document[]>('/documents'),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<Document>('/documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  delete: (id: string) =>
    api.delete(`/documents/${id}`),
};
