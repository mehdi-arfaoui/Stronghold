import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Upload, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingState } from '@/components/common/LoadingState';
import { EmptyState } from '@/components/common/EmptyState';
import { formatRelativeTime } from '@/lib/formatters';
import { documentsApi } from '@/api/documents.api';

export function DocumentsPage() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['documents'],
    queryFn: async () => (await documentsApi.getAll()).data,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => documentsApi.upload(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document uploade');
    },
    onError: () => toast.error("Erreur lors de l'upload"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Document supprime');
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => uploadMutation.mutate(file));
  }, [uploadMutation]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => uploadMutation.mutate(file));
  }, [uploadMutation]);

  if (query.isLoading) return <LoadingState variant="skeleton" message="Chargement des documents..." count={4} />;

  const documents = query.data ?? [];

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <Card>
        <CardContent
          className="flex flex-col items-center justify-center border-2 border-dashed p-8"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Glissez-deposez vos fichiers ici</p>
          <p className="text-xs text-muted-foreground">ou</p>
          <label>
            <input type="file" className="hidden" multiple onChange={handleFileSelect} />
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <span>Parcourir</span>
            </Button>
          </label>
        </CardContent>
      </Card>

      {/* Documents list */}
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucun document"
          description="Uploadez des documents PRA/PCA existants pour extraction automatique."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documents ({documents.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Taille</TableHead>
                  <TableHead>Upload</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell>{doc.type}</TableCell>
                    <TableCell>{(doc.size / 1024).toFixed(0)} Ko</TableCell>
                    <TableCell>{formatRelativeTime(doc.uploadedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={doc.status === 'ready' ? 'default' : doc.status === 'error' ? 'destructive' : 'secondary'}>
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(doc.id)}>
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
