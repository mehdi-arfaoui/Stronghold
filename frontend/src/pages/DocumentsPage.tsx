import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileText, Upload, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { normalizeLanguage } from '@/i18n/locales';
import { formatRelativeTime } from '@/lib/formatters';
import { documentsApi } from '@/api/documents.api';

const COPY = {
  fr: {
    loading: 'Chargement des documents...',
    uploaded: 'Document uploadé',
    uploadError: 'Erreur lors de l’upload',
    deleted: 'Document supprimé',
    drop: 'Glissez-déposez vos fichiers ici',
    browse: 'Parcourir',
    emptyTitle: 'Aucun document',
    emptyDescription: 'Uploadez des documents PRA/PCA existants pour extraction automatique.',
    title: 'Documents',
    name: 'Nom',
    type: 'Type',
    size: 'Taille',
    upload: 'Upload',
    status: 'Statut',
    kb: 'Ko',
  },
  en: {
    loading: 'Loading documents...',
    uploaded: 'Document uploaded',
    uploadError: 'Upload failed',
    deleted: 'Document deleted',
    drop: 'Drag and drop your files here',
    browse: 'Browse',
    emptyTitle: 'No document',
    emptyDescription: 'Upload existing DR/BCP documents for automatic extraction.',
    title: 'Documents',
    name: 'Name',
    type: 'Type',
    size: 'Size',
    upload: 'Upload',
    status: 'Status',
    kb: 'KB',
  },
  es: {
    loading: 'Cargando documentos...',
    uploaded: 'Documento cargado',
    uploadError: 'Error durante la carga',
    deleted: 'Documento eliminado',
    drop: 'Arrastra tus archivos aquí',
    browse: 'Explorar',
    emptyTitle: 'Ningún documento',
    emptyDescription: 'Sube documentos PRA/PCA existentes para extracción automática.',
    title: 'Documentos',
    name: 'Nombre',
    type: 'Tipo',
    size: 'Tamaño',
    upload: 'Carga',
    status: 'Estado',
    kb: 'KB',
  },
  it: {
    loading: 'Caricamento documenti...',
    uploaded: 'Documento caricato',
    uploadError: 'Errore durante l’upload',
    deleted: 'Documento eliminato',
    drop: 'Trascina qui i tuoi file',
    browse: 'Sfoglia',
    emptyTitle: 'Nessun documento',
    emptyDescription: 'Carica documenti PRA/PCA esistenti per l’estrazione automatica.',
    title: 'Documenti',
    name: 'Nome',
    type: 'Tipo',
    size: 'Dimensione',
    upload: 'Upload',
    status: 'Stato',
    kb: 'KB',
  },
  zh: {
    loading: '正在加载文档...',
    uploaded: '文档已上传',
    uploadError: '上传失败',
    deleted: '文档已删除',
    drop: '将文件拖放到这里',
    browse: '浏览',
    emptyTitle: '暂无文档',
    emptyDescription: '上传现有 PRA/PCA 文档以进行自动提取。',
    title: '文档',
    name: '名称',
    type: '类型',
    size: '大小',
    upload: '上传',
    status: '状态',
    kb: 'KB',
  },
} as const;

export function DocumentsPage() {
  const { i18n } = useTranslation();
  const copy = COPY[normalizeLanguage(i18n.resolvedLanguage)];
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['documents'],
    queryFn: async () => (await documentsApi.getAll()).data,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => documentsApi.upload(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(copy.uploaded);
    },
    onError: () => toast.error(copy.uploadError),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(copy.deleted);
    },
  });

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    files.forEach((file) => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => uploadMutation.mutate(file));
  }, [uploadMutation]);

  if (query.isLoading) {
    return <LoadingState variant="skeleton" message={copy.loading} count={4} />;
  }

  const documents = query.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent
          className="flex flex-col items-center justify-center border-2 border-dashed p-8"
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
        >
          <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{copy.drop}</p>
          <p className="text-xs text-muted-foreground">or</p>
          <label>
            <input type="file" className="hidden" multiple onChange={handleFileSelect} />
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <span>{copy.browse}</span>
            </Button>
          </label>
        </CardContent>
      </Card>

      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={copy.emptyTitle}
          description={copy.emptyDescription}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {copy.title} ({documents.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.name}</TableHead>
                  <TableHead>{copy.type}</TableHead>
                  <TableHead>{copy.size}</TableHead>
                  <TableHead>{copy.upload}</TableHead>
                  <TableHead>{copy.status}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="font-medium">{document.name}</TableCell>
                    <TableCell>{document.type}</TableCell>
                    <TableCell>{(document.size / 1024).toFixed(0)} {copy.kb}</TableCell>
                    <TableCell>{formatRelativeTime(document.uploadedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={document.status === 'ready' ? 'default' : document.status === 'error' ? 'destructive' : 'secondary'}>
                        {document.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(document.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
