import {
  GetProductsCommand,
  PricingClient,
  type PricingClientConfig,
  type FilterType,
  type GetProductsCommandOutput,
} from "@aws-sdk/client-pricing";

export type AwsPricingFilter = {
  field: string;
  value: string;
  type?: FilterType;
};

export type AwsPricingQuery = {
  serviceCode: string;
  filters?: AwsPricingFilter[];
  maxResults?: number;
  maxPages?: number;
  formatVersion?: string;
};

export type AwsPricingProductsResult = {
  priceList: any[];
  rawCount: number;
  nextToken?: string;
  region: string;
};

const DEFAULT_REGION = process.env.AWS_PRICING_REGION || "us-east-1";
let cachedPricingClient: PricingClient | null = null;

function buildPricingClientConfig(): PricingClientConfig {
  const config: PricingClientConfig = {
    region: DEFAULT_REGION,
  };

  const accessKeyId = process.env.AWS_PRICING_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_PRICING_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
    };
  }

  return config;
}

function getPricingClient(): PricingClient {
  if (!cachedPricingClient) {
    cachedPricingClient = new PricingClient(buildPricingClientConfig());
  }
  return cachedPricingClient;
}

export async function fetchAwsPricingProducts(
  query: AwsPricingQuery
): Promise<AwsPricingProductsResult> {
  const client = getPricingClient();
  const filters =
    query.filters?.map((filter) => ({
      Type: filter.type ?? "TERM_MATCH",
      Field: filter.field,
      Value: filter.value,
    })) ?? [];

  const maxResults = Math.min(Math.max(query.maxResults ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(query.maxPages ?? 1, 1), 10);

  let nextToken: string | undefined = undefined;
  let pageCount = 0;
  const priceList: any[] = [];

  do {
    const command = new GetProductsCommand({
      ServiceCode: query.serviceCode,
      ...(filters.length > 0 ? { Filters: filters } : {}),
      FormatVersion: query.formatVersion ?? "aws_v1",
      MaxResults: maxResults,
      NextToken: nextToken,
    });
    const response: GetProductsCommandOutput = await client.send(command);
    if (response.PriceList?.length) {
      priceList.push(...response.PriceList);
    }
    nextToken = response.NextToken;
    pageCount += 1;
  } while (nextToken && pageCount < maxPages);

  const parsed = priceList.map((entry) => (typeof entry === "string" ? JSON.parse(entry) : entry));

  return {
    priceList: parsed,
    rawCount: priceList.length,
    region: DEFAULT_REGION,
    ...(nextToken ? { nextToken } : {}),
  };
}
