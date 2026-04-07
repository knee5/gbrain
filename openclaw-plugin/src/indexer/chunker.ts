import type { ParsedPage } from "./parser.js";

export type ChunkType = "summary" | "compiled_truth" | "timeline";

export interface Chunk {
  chunkType: ChunkType;
  content: string;
  /** Ordering position within the page */
  position: number;
  /** Rough token count estimate (chars / 4) */
  tokenCount: number;
}

/** Rough token estimator — 1 token ≈ 4 characters */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a structured text header from frontmatter fields for the summary chunk.
 * This ensures the embedding captures entity metadata (type, title, aliases, tags).
 */
function buildFrontmatterText(page: ParsedPage): string {
  const lines: string[] = [];
  lines.push(`Title: ${page.title}`);
  lines.push(`Type: ${page.type}`);
  if (page.aliases.length > 0) {
    lines.push(`Aliases: ${page.aliases.join(", ")}`);
  }
  const tags = page.frontmatter.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    lines.push(`Tags: ${tags.join(", ")}`);
  }
  if (page.frontmatter.created) {
    lines.push(`Created: ${page.frontmatter.created}`);
  }
  if (page.frontmatter.updated) {
    lines.push(`Updated: ${page.frontmatter.updated}`);
  }
  return lines.join("\n");
}

/**
 * Extract the executive summary — the first paragraph of the compiled truth
 * before any section headers appear.
 */
function extractExecutiveSummary(compiledTruth: string): string {
  const lines = compiledTruth.split("\n");
  const summaryLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("#") && summaryLines.length > 0) break;
    summaryLines.push(line);
  }
  return summaryLines.join("\n").trim();
}

/**
 * Split timeline section into individual entries.
 * Timeline entries typically start with:
 *   - **YYYY-MM-DD**: ...
 *   - **YYYY-MM-DD** ...
 *   ### YYYY-MM-DD
 */
function splitTimelineEntries(timeline: string, maxTokens: number): string[] {
  if (!timeline.trim()) return [];

  // Split on lines that look like dated entries
  const entryBoundary = /^(?:- \*\*\d{4}|\*\*\d{4}|### \d{4}|## \d{4})/m;
  const parts = timeline.split(/\n(?=- \*\*\d{4}|\*\*\d{4}|### \d{4}|## \d{4})/);

  if (parts.length <= 1) {
    // Can't split by date entries — chunk by token count
    return chunkByTokens(timeline, maxTokens);
  }

  // Group small consecutive entries into one chunk
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const combined = current ? `${current}\n${part}` : part;
    if (estimateTokens(combined) > maxTokens && current) {
      chunks.push(current.trim());
      current = part;
    } else {
      current = combined;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Split a large text block into chunks of at most maxTokens, breaking at paragraph boundaries. */
function chunkByTokens(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const combined = current ? `${current}\n\n${para}` : para;
    if (estimateTokens(combined) > maxTokens && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = combined;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function chunkPage(
  page: ParsedPage,
  maxTokens: number,
  indexTimeline: boolean
): Chunk[] {
  const chunks: Chunk[] = [];
  let position = 0;

  // Chunk 1: Frontmatter metadata + executive summary (highest signal)
  const frontmatterText = buildFrontmatterText(page);
  const executiveSummary = extractExecutiveSummary(page.compiledTruth);
  const summaryContent = executiveSummary
    ? `${frontmatterText}\n\n${executiveSummary}`
    : frontmatterText;

  if (summaryContent.trim()) {
    chunks.push({
      chunkType: "summary",
      content: summaryContent.trim(),
      position: position++,
      tokenCount: estimateTokens(summaryContent),
    });
  }

  // Chunk 2+: Compiled truth body (State, Open Threads, See Also, etc.)
  const compiledTruthBody = page.compiledTruth.trim();
  if (compiledTruthBody) {
    const compiledChunks = chunkByTokens(compiledTruthBody, maxTokens);
    for (const chunk of compiledChunks) {
      if (chunk.trim()) {
        chunks.push({
          chunkType: "compiled_truth",
          content: chunk,
          position: position++,
          tokenCount: estimateTokens(chunk),
        });
      }
    }
  }

  // Chunk 3+: Timeline entries (optional)
  if (indexTimeline && page.timeline.trim()) {
    const timelineChunks = splitTimelineEntries(page.timeline, maxTokens);
    for (const chunk of timelineChunks) {
      if (chunk.trim()) {
        chunks.push({
          chunkType: "timeline",
          content: chunk,
          position: position++,
          tokenCount: estimateTokens(chunk),
        });
      }
    }
  }

  return chunks;
}
