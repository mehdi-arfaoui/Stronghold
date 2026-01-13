export type AzureRetailQuery = {
  filter?: string;
  maxPages?: number;
  pageSize?: number;
  currencyCode?: string;
  locale?: string;
  region?: string;
};

export type AzureRetailResult = {
  items: any[];
  rawCount: number;
  nextPageLink?: string | null;
};

const AZURE_RETAIL_ENDPOINT = "https://prices.azure.com/api/retail/prices";

export async function fetchAzureRetailPrices(query: AzureRetailQuery): Promise<AzureRetailResult> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 1000);
  const maxPages = Math.min(Math.max(query.maxPages ?? 1, 1), 10);

  let nextPageLink: string | null = null;
  let pageCount = 0;
  let url = new URL(AZURE_RETAIL_ENDPOINT);

  if (query.filter) {
    url.searchParams.set("$filter", query.filter);
  }
  url.searchParams.set("$top", String(pageSize));
  if (query.currencyCode) {
    url.searchParams.set("currencyCode", query.currencyCode);
  }
  if (query.locale) {
    url.searchParams.set("locale", query.locale);
  }
  if (query.region) {
    url.searchParams.set("region", query.region);
  }

  const items: any[] = [];

  do {
    const response = await fetch(nextPageLink ?? url.toString());
    if (!response.ok) {
      throw new Error(`Azure pricing request failed with status ${response.status}`);
    }
    const payload = await response.json();
    const pageItems = Array.isArray(payload.Items) ? payload.Items : [];
    items.push(...pageItems);
    nextPageLink = payload.NextPageLink ?? null;
    pageCount += 1;
  } while (nextPageLink && pageCount < maxPages);

  return {
    items,
    rawCount: items.length,
    nextPageLink,
  };
}
