import { z } from "zod";
import { decodeHTML } from "entities";
import { getApiKey } from "@/lib/api-keys";
import { FirecrawlService } from "@/lib/enrichment/services/firecrawl";
import { externalError, itemResponse } from "../helpers";

type PublicSearchResult = {
  url: string;
  title: string;
  description: string;
  content: string;
};

function stripMarkup(value: string) {
  return decodeHTML(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function unwrapDuckDuckGoUrl(value: string) {
  const decoded = decodeHTML(value);
  try {
    const url = new URL(decoded, "https://html.duckduckgo.com");
    return url.searchParams.get("uddg") || url.href;
  } catch {
    return decoded;
  }
}

export async function searchPublicWeb(query: string, limit: number): Promise<PublicSearchResult[]> {
  const endpoint = new URL("https://html.duckduckgo.com/html/");
  endpoint.searchParams.set("q", query);
  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; NextCRM/1.0; +https://sm.a-vjuh.ru)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) externalError(`PUBLIC_WEB_SEARCH_HTTP_${response.status}`);

  const html = await response.text();
  const blocks = html.split(/class=["']result\s+results_links[^"']*["']/i).slice(1);
  const results: PublicSearchResult[] = [];
  for (const block of blocks) {
    const link = block.match(/class=["']result__a["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const url = unwrapDuckDuckGoUrl(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    const description = stripMarkup(snippet?.[1] || "");
    results.push({
      url,
      title: stripMarkup(link[2]),
      description,
      content: description,
    });
    if (results.length >= limit) break;
  }
  // An empty search page is a valid business result, not an infrastructure
  // failure. Returning [] lets the researcher reformulate the query within
  // the same run instead of failing and retrying the whole task.
  return results;
}

export const crmWebSearchTools = [{
  name: "crm_web_search",
  description: "Search public web sources for verifiable B2B prospects. Returns URLs, titles, descriptions and page excerpts; it never creates CRM records.",
  schema: z.object({
    query: z.string().min(3).max(500),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async handler(args: { query: string; limit: number }, userId: string) {
    const key = await getApiKey("FIRECRAWL", userId);
    const results = key
      ? await new FirecrawlService(key).search(args.query, {
          limit: args.limit,
          scrapeContent: true,
        })
      : await searchPublicWeb(args.query, args.limit);
    return itemResponse({
      query: args.query,
      provider: key ? "firecrawl" : "duckduckgo-html",
      checkedAt: new Date().toISOString(),
      results,
    });
  },
}];
