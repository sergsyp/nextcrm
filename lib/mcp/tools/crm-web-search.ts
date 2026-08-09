import { z } from "zod";
import { getApiKey } from "@/lib/api-keys";
import { FirecrawlService } from "@/lib/enrichment/services/firecrawl";
import { externalError, itemResponse } from "../helpers";

export const crmWebSearchTools = [{
  name: "crm_web_search",
  description: "Search public web sources for verifiable B2B prospects. Returns URLs, titles, descriptions and page excerpts; it never creates CRM records.",
  schema: z.object({
    query: z.string().min(3).max(500),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async handler(args: { query: string; limit: number }, userId: string) {
    const key = await getApiKey("FIRECRAWL", userId);
    if (!key) externalError("FIRECRAWL_NOT_CONFIGURED");
    const results = await new FirecrawlService(key!).search(args.query, {
      limit: args.limit,
      scrapeContent: true,
    });
    return itemResponse({ query: args.query, checkedAt: new Date().toISOString(), results });
  },
}];
