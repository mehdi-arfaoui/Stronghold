import { GetProductsCommand, PricingClient } from "@aws-sdk/client-pricing";

export type AwsPricingFilter = {
  field: string;
  value: string;
  type?: "TERM_MATCH" | "RANGE" | "ANY" | "GREATER_THAN" | "LESS_THAN";
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

export async function fetchAwsPricingProducts(
  query: AwsPricingQuery
): Promise<AwsPricingProductsResult> {
  const client = new PricingClient({ region: DEFAULT_REGION });
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
      Filters: filters.length > 0 ? filters : undefined,
      FormatVersion: query.formatVersion ?? "aws_v1",
      MaxResults: maxResults,
      NextToken: nextToken,
    });
    const response = await client.send(command);
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
    nextToken,
    region: DEFAULT_REGION,
  };
}
