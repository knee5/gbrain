import { embedQuery } from "../indexer/embedder.js";
import type { GBrainStore } from "../indexer/store.js";

export interface ResolveParams {
  name: string;
  type?: "person" | "company" | "deal" | "meeting" | "any";
}

export interface ResolveCandidate {
  path: string;
  type: string;
  title: string;
  confidence: number;
  matchReason: string;
  excerpt: string;
  aliases: string[];
}

export interface ResolveResult {
  /** Best match, or null if nothing found */
  match: ResolveCandidate | null;
  /** Top-3 candidates for disambiguation */
  candidates: ResolveCandidate[];
  queryTimeMs: number;
}

const MATCH_CONFIDENCE: Record<string, number> = {
  exact_path: 0.99,
  exact_title: 0.97,
  alias: 0.92,
  fuzzy: 0.75,
  embedding: 0.60,
};

function truncate(text: string, maxChars = 300): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).replace(/\s\S*$/, "") + "…";
}

export async function executeResolve(
  params: ResolveParams,
  store: GBrainStore,
  apiKey: string
): Promise<ResolveResult> {
  const startMs = Date.now();
  const { name, type = "any" } = params;

  const candidates: ResolveCandidate[] = [];

  // 1–4: Exact/fuzzy text match on filename, title, aliases
  const textMatches = store.searchByName(name, type);
  for (const { page, matchType } of textMatches.slice(0, 10)) {
    candidates.push({
      path: page.path,
      type: page.type,
      title: page.title,
      confidence: MATCH_CONFIDENCE[matchType] ?? 0.5,
      matchReason: matchType,
      excerpt: truncate(page.compiled_truth),
      aliases: JSON.parse(page.aliases) as string[],
    });
  }

  // 5: Embedding similarity fallback (only if we have few text matches)
  if (candidates.length < 3 && apiKey) {
    try {
      const queryEmbedding = await embedQuery(name, { apiKey });
      const embeddingMatches = store.searchByEmbedding(queryEmbedding, {
        scope: type !== "any" ? `${type}s` : undefined,
        limit: 5,
        excludeTimeline: true,
      });

      for (const hit of embeddingMatches) {
        // Don't add duplicates already found by text match
        const alreadyFound = candidates.some((c) => c.path === hit.path);
        if (!alreadyFound) {
          candidates.push({
            path: hit.path,
            type: hit.type,
            title: hit.title,
            confidence: Math.round(hit.score * MATCH_CONFIDENCE["embedding"]! * 100) / 100,
            matchReason: "embedding",
            excerpt: truncate(hit.content),
            aliases: hit.aliases,
          });
        }
      }
    } catch {
      // Embedding lookup failed — ignore, text matches are enough
    }
  }

  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);

  const top3 = candidates.slice(0, 3);
  const best = top3[0] ?? null;

  // Only return a match if confidence is reasonable
  const match = best && best.confidence >= 0.6 ? best : null;

  return {
    match,
    candidates: top3,
    queryTimeMs: Date.now() - startMs,
  };
}
