import { embedQuery } from "../indexer/embedder.js";
import type { GBrainStore, ChunkSearchResult } from "../indexer/store.js";

export interface QueryParams {
  query: string;
  scope?: "all" | "people" | "companies" | "deals" | "meetings" | "projects" | "yc" | "civic";
  limit?: number;
  includeTimeline?: boolean;
}

export interface QueryResultItem {
  path: string;
  type: string;
  title: string;
  score: number;
  excerpt: string;
  updatedAt: string;
  relatedEntities: string[];
}

export interface QueryResult {
  results: QueryResultItem[];
  totalIndexed: number;
  queryTimeMs: number;
}

/** Scope value to directory prefix mapping */
const SCOPE_TO_DIR: Record<string, string> = {
  people: "people",
  companies: "companies",
  deals: "deals",
  meetings: "meetings",
  projects: "projects",
  yc: "yc",
  civic: "civic",
};

/** Deduplicate results: keep only the best-scoring chunk per page. */
function deduplicateByPage(results: ChunkSearchResult[]): ChunkSearchResult[] {
  const best = new Map<number, ChunkSearchResult>();
  for (const r of results) {
    const existing = best.get(r.pageId);
    if (!existing || r.score > existing.score) {
      best.set(r.pageId, r);
    }
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

function truncateExcerpt(text: string, maxChars = 400): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s\S*$/, "") + "…";
}

export async function executeQuery(
  params: QueryParams,
  store: GBrainStore,
  apiKey: string
): Promise<QueryResult> {
  const startMs = Date.now();

  const {
    query,
    scope = "all",
    limit = 5,
    includeTimeline = false,
  } = params;

  // Embed the query
  const queryEmbedding = await embedQuery(query, { apiKey });

  const dirScope = scope !== "all" ? (SCOPE_TO_DIR[scope] ?? scope) : undefined;

  // Search: fetch more than needed to allow deduplication
  const raw = store.searchByEmbedding(queryEmbedding, {
    scope: dirScope,
    limit: limit * 4,
    excludeTimeline: !includeTimeline,
  });

  // Deduplicate per page then take top N
  const deduped = deduplicateByPage(raw).slice(0, limit);

  // For each result, fetch related entities from edges table (via getPageById)
  const stats = store.getStats();

  const results: QueryResultItem[] = deduped.map((hit) => {
    const fm = hit.frontmatter;
    const related: string[] = [];
    if (Array.isArray(fm["related"])) {
      related.push(...(fm["related"] as string[]));
    }

    return {
      path: hit.path,
      type: hit.type,
      title: hit.title,
      score: Math.round(hit.score * 1000) / 1000,
      excerpt: truncateExcerpt(hit.content),
      updatedAt: hit.updatedAt,
      relatedEntities: related,
    };
  });

  return {
    results,
    totalIndexed: stats.pageCount,
    queryTimeMs: Date.now() - startMs,
  };
}
