import { readFileSync } from "fs";
import { createHash } from "crypto";
import { relative } from "path";
import matter from "gray-matter";

export interface PageFrontmatter {
  title?: string;
  type?: string;
  created?: string;
  updated?: string;
  tags?: string[];
  aliases?: string[];
  sources?: string[];
  related?: string[];
  attendees?: string[];
  investors?: string[];
  company?: string;
  [key: string]: unknown;
}

export interface ParsedPage {
  /** Path relative to brainRoot, e.g. "people/pedro-franceschi.md" */
  relativePath: string;
  /** Absolute filesystem path */
  fullPath: string;
  /** SHA-256 of file content */
  contentHash: string;
  frontmatter: PageFrontmatter;
  /** Content above the timeline separator (curated intelligence) */
  compiledTruth: string;
  /** Content below the timeline separator (chronological entries) */
  timeline: string;
  /** Related entity paths extracted from wiki-links and markdown links */
  relatedPaths: string[];
  /** Inferred type (from frontmatter or directory heuristic) */
  type: string;
  /** Display title (from frontmatter or filename) */
  title: string;
  /** Aliases for fuzzy entity resolution */
  aliases: string[];
}

/** Patterns that signal the start of the timeline section */
const TIMELINE_SEPARATORS = [
  /^---$/m,
  /^## Timeline$/im,
  /^## \d{4}/m,
];

/** Regex to match wiki-links: [[path]] or [[path|label]] */
const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
/** Regex to match markdown links pointing to .md files: [label](path.md) */
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+\.md)\)/g;

export function parseMarkdown(fullPath: string, brainRoot: string): ParsedPage {
  const raw = readFileSync(fullPath, "utf-8");
  const contentHash = createHash("sha256").update(raw).digest("hex");
  const relativePath = relative(brainRoot, fullPath).replace(/\\/g, "/");

  const parsed = matter(raw);
  const frontmatter = parsed.data as PageFrontmatter;
  const body = parsed.content;

  const { compiledTruth, timeline } = splitCompiledTruthAndTimeline(body);
  const relatedPaths = extractRelatedPaths(body);
  const type = inferType(frontmatter, relativePath);
  const title = frontmatter.title ?? inferTitle(relativePath);
  const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [];

  return {
    relativePath,
    fullPath,
    contentHash,
    frontmatter,
    compiledTruth: compiledTruth.trim(),
    timeline: timeline.trim(),
    relatedPaths,
    type,
    title,
    aliases,
  };
}

function splitCompiledTruthAndTimeline(body: string): {
  compiledTruth: string;
  timeline: string;
} {
  for (const pattern of TIMELINE_SEPARATORS) {
    const match = pattern.exec(body);
    if (match && match.index !== undefined) {
      return {
        compiledTruth: body.slice(0, match.index),
        timeline: body.slice(match.index + match[0].length),
      };
    }
  }

  // No separator found — treat whole body as compiled truth
  return { compiledTruth: body, timeline: "" };
}

function extractRelatedPaths(body: string): string[] {
  const paths = new Set<string>();

  let m: RegExpExecArray | null;

  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(body)) !== null) {
    const link = m[1].trim();
    // wiki-links may or may not have .md — normalize
    paths.add(link.endsWith(".md") ? link : `${link}.md`);
  }

  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(body)) !== null) {
    paths.add(m[2].trim());
  }

  return Array.from(paths);
}

function inferType(fm: PageFrontmatter, relativePath: string): string {
  if (fm.type) return fm.type;

  const dir = relativePath.split("/")[0];
  const dirTypeMap: Record<string, string> = {
    people: "person",
    companies: "company",
    deals: "deal",
    meetings: "meeting",
    projects: "project",
    yc: "yc",
    civic: "civic",
    concepts: "concept",
    sources: "source",
    media: "media",
  };
  return dirTypeMap[dir] ?? "unknown";
}

function inferTitle(relativePath: string): string {
  const filename = relativePath.split("/").pop() ?? relativePath;
  return filename
    .replace(/\.md$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
