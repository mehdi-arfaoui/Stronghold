export type ChromaQueryResponse = {
  ids: string[][];
  documents?: string[][];
  metadatas?: Record<string, unknown>[][];
  distances?: number[][];
};

export type ChromaQueryParams = {
  collection: string;
  queryTexts: string[];
  tenantId: string;
  documentIds?: string[] | null;
  nResults?: number;
};

function buildChromaHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.CHROMADB_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CHROMADB_API_TOKEN}`;
  }
  return headers;
}

function buildWhereClause(tenantId: string, documentIds?: string[] | null): Record<string, unknown> {
  const whereClause: Record<string, unknown> = { tenantId };
  if (documentIds && documentIds.length > 0) {
    whereClause.documentId = { $in: documentIds };
  }
  return whereClause;
}

export async function queryChromaCollection(
  params: ChromaQueryParams
): Promise<ChromaQueryResponse | null> {
  const chromaUrl = process.env.CHROMADB_URL;
  if (!chromaUrl) {
    return null;
  }

  const payload = {
    query_texts: params.queryTexts,
    n_results: params.nResults,
    where: buildWhereClause(params.tenantId, params.documentIds),
    include: ["documents", "metadatas", "distances"],
  };

  const response = await fetch(`${chromaUrl}/api/v1/collections/${params.collection}/query`, {
    method: "POST",
    headers: buildChromaHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to query ChromaDB: ${response.status} ${errText}`);
  }

  return (await response.json()) as ChromaQueryResponse;
}
