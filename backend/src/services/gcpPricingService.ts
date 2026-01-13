export type GcpSkuQuery = {
  serviceId: string;
  pageSize?: number;
  maxPages?: number;
};

export type GcpSkuResult = {
  skus: any[];
  rawCount: number;
  nextPageToken?: string | null;
};

const GCP_CATALOG_ENDPOINT = "https://cloudbilling.googleapis.com/v1/services";
const GCP_API_KEY = process.env.GCP_PRICING_API_KEY;

export async function fetchGcpSkus(query: GcpSkuQuery): Promise<GcpSkuResult> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 5000);
  const maxPages = Math.min(Math.max(query.maxPages ?? 1, 1), 10);

  let nextPageToken: string | null = null;
  let pageCount = 0;
  const skus: any[] = [];

  do {
    const url = new URL(`${GCP_CATALOG_ENDPOINT}/${query.serviceId}/skus`);
    url.searchParams.set("pageSize", String(pageSize));
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }
    if (GCP_API_KEY) {
      url.searchParams.set("key", GCP_API_KEY);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`GCP pricing request failed with status ${response.status}`);
    }
    const payload = await response.json();
    const pageSkus = Array.isArray(payload.skus) ? payload.skus : [];
    skus.push(...pageSkus);
    nextPageToken = payload.nextPageToken ?? null;
    pageCount += 1;
  } while (nextPageToken && pageCount < maxPages);

  return {
    skus,
    rawCount: skus.length,
    nextPageToken,
  };
}
