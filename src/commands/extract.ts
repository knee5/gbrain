/**
 * gbrain extract — Extract links and timeline entries from brain markdown files.
 *
 * Subcommands:
 *   gbrain extract links [--dir <brain>] [--dry-run] [--json]
 *   gbrain extract timeline [--dir <brain>] [--dry-run] [--json]
 *   gbrain extract all [--dir <brain>] [--dry-run] [--json]
 */

import { readFileSync, readdirSync, lstatSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import type { BrainEngine } from '../core/engine.ts';
import { parseMarkdown } from '../core/markdown.ts';

// --- Types ---

export interface ExtractedLink {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
}

export interface ExtractedTimelineEntry {
  slug: string;
  date: string;
  source: string;
  summary: string;
  detail?: string;
}

interface ExtractResult {
  links_created: number;
  timeline_entries_created: number;
  pages_processed: number;
}

// --- Shared walker ---

export function walkMarkdownFiles(dir: string): { path: string; relPath: string }[] {
  const files: { path: string; relPath: string }[] = [];
  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      if (entry.startsWith('.')) continue;
      const full = join(d, entry);
      try {
        if (lstatSync(full).isDirectory()) {
          walk(full);
        } else if (entry.endsWith('.md') && !entry.startsWith('_')) {
          files.push({ path: full, relPath: relative(dir, full) });
        }
      } catch { /* skip unreadable */ }
    }
  }
  walk(dir);
  return files;
}

// --- Link extraction ---

/** Extract markdown links to .md files (relative paths only).
 *
 * Handles two syntaxes:
 *   1. Standard markdown:  [text](relative/path.md)
 *   2. Wikilinks:          [[relative/path]] or [[relative/path|Display Text]]
 *
 * Both are resolved relative to the file that contains them, so the caller
 * receives a relTarget that can be joined with dirname(relPath) to get the
 * absolute slug.  External URLs (containing ://) are always skipped.
 */
export function extractMarkdownLinks(content: string): { name: string; relTarget: string }[] {
  const results: { name: string; relTarget: string }[] = [];

  // Standard markdown links: [text](relative/path.md)
  const mdPattern = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
  let match;
  while ((match = mdPattern.exec(content)) !== null) {
    const target = match[2];
    if (target.includes('://')) continue; // skip external URLs
    results.push({ name: match[1], relTarget: target });
  }

  // Wikilinks: [[path/to/page]] or [[path/to/page|Display Text]]
  // Path may or may not carry a .md suffix; normalise to include it.
  // Skip external URLs like [[https://example.com|Title]].
  // Strip section anchors: [[page#section|Title]] → page
  const wikiPattern = /\[\[([^|\]]+?)(?:\|[^\]]*?)?\]\]/g;
  while ((match = wikiPattern.exec(content)) !== null) {
    const rawPath = match[1].trim();
    if (rawPath.includes('://')) continue; // skip [[https://...]]
    // Strip section anchors (#heading) — they're intra-page refs, not page slugs
    const hashIdx = rawPath.indexOf('#');
    const pagePath = hashIdx >= 0 ? rawPath.slice(0, hashIdx) : rawPath;
    if (!pagePath) continue; // bare [[#anchor]] — same-page ref, skip
    const relTarget = pagePath.endsWith('.md') ? pagePath : pagePath + '.md';
    // Use the display text portion if present, otherwise the raw path
    const pipeIdx = match[0].indexOf('|');
    const displayName = pipeIdx >= 0
      ? match[0].slice(pipeIdx + 1, -2).trim()
      : rawPath;
    results.push({ name: displayName, relTarget });
  }

  return results;
}

/**
 * Resolve a wikilink target (relative path from extractMarkdownLinks) to a
 * canonical slug, given the directory of the containing page and the set of
 * all known slugs in the brain.
 *
 * Wiki KBs often use inconsistent relative depths:
 *   - Same-directory bare name: [[foo-bar]] from tech/wiki/analysis/ → tech/wiki/analysis/foo-bar  ✓
 *   - Cross-type shorthand: [[analysis/foo]] from {domain}/wiki/guides/ → {domain}/wiki/analysis/foo
 *     (author omits the leading ../ because they think in "wiki-root-relative" terms)
 *   - Cross-domain with one-too-few ../: [[../../finance/wiki/...]] from {domain}/wiki/analysis/
 *     resolves to {domain}/finance/wiki/... instead of finance/wiki/... because depth-3 dirs
 *     need 3 × ../ to reach KB root, but authors only write 2 ×
 *
 * Resolution order (first match wins):
 *   1. Standard join(fileDir, relTarget) — exact relative path as written
 *   2. Progressively strip leading path components from fileDir (ancestor search):
 *      tries parent dir, grandparent dir, … up to KB root.
 *      Handles both cross-type and cross-domain under-specified paths.
 *
 * Returns null when no matching slug is found (dangling link).
 */
export function resolveSlug(fileDir: string, relTarget: string, allSlugs: Set<string>): string | null {
  const targetNoExt = relTarget.endsWith('.md') ? relTarget.slice(0, -3) : relTarget;

  // Strategy 1: standard relative resolution
  const s1 = join(fileDir, targetNoExt);
  if (allSlugs.has(s1)) return s1;

  // Strategy 2: ancestor search — try each parent directory in turn.
  // This resolves links whose authors omitted one or more leading ../
  // (common when targeting sibling subdirectories or cross-domain pages).
  const parts = fileDir.split('/').filter(Boolean);
  for (let strip = 1; strip <= parts.length; strip++) {
    const ancestor = parts.slice(0, parts.length - strip).join('/');
    const candidate = ancestor ? join(ancestor, targetNoExt) : targetNoExt;
    if (allSlugs.has(candidate)) return candidate;
  }

  return null;
}

/** Infer link type from directory structure */
function inferLinkType(fromDir: string, toDir: string, frontmatter?: Record<string, unknown>): string {
  const from = fromDir.split('/')[0];
  const to = toDir.split('/')[0];
  if (from === 'people' && to === 'companies') {
    if (Array.isArray(frontmatter?.founded)) return 'founded';
    return 'works_at';
  }
  if (from === 'people' && to === 'deals') return 'involved_in';
  if (from === 'deals' && to === 'companies') return 'deal_for';
  if (from === 'meetings' && to === 'people') return 'attendee';
  return 'mention';
}

/** Extract links from frontmatter fields */
function extractFrontmatterLinks(slug: string, fm: Record<string, unknown>): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const fieldMap: Record<string, { dir: string; type: string }> = {
    company: { dir: 'companies', type: 'works_at' },
    companies: { dir: 'companies', type: 'works_at' },
    investors: { dir: 'companies', type: 'invested_in' },
    attendees: { dir: 'people', type: 'attendee' },
    founded: { dir: 'companies', type: 'founded' },
  };
  for (const [field, config] of Object.entries(fieldMap)) {
    const value = fm[field];
    if (!value) continue;
    const slugs = Array.isArray(value) ? value : [value];
    for (const s of slugs) {
      if (typeof s !== 'string') continue;
      const toSlug = `${config.dir}/${s.toLowerCase().replace(/\s+/g, '-')}`;
      links.push({ from_slug: slug, to_slug: toSlug, link_type: config.type, context: `frontmatter.${field}` });
    }
  }
  return links;
}

/** Parse frontmatter using the project's gray-matter-based parser */
function parseFrontmatterFromContent(content: string, relPath: string): Record<string, unknown> {
  try {
    const parsed = parseMarkdown(content, relPath);
    return parsed.frontmatter;
  } catch {
    return {};
  }
}

/** Full link extraction from a single markdown file */
export function extractLinksFromFile(
  content: string, relPath: string, allSlugs: Set<string>,
): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const slug = relPath.replace('.md', '');
  const fileDir = dirname(relPath);
  const fm = parseFrontmatterFromContent(content, relPath);

  for (const { name, relTarget } of extractMarkdownLinks(content)) {
    const resolved = resolveSlug(fileDir, relTarget, allSlugs);
    if (resolved !== null) {
      links.push({
        from_slug: slug, to_slug: resolved,
        link_type: inferLinkType(fileDir, dirname(resolved), fm),
        context: `markdown link: [${name}]`,
      });
    }
  }

  links.push(...extractFrontmatterLinks(slug, fm));
  return links;
}

// --- Timeline extraction ---

/** Extract timeline entries from markdown content */
export function extractTimelineFromContent(content: string, slug: string): ExtractedTimelineEntry[] {
  const entries: ExtractedTimelineEntry[] = [];

  // Format 1: Bullet — - **YYYY-MM-DD** | Source — Summary
  const bulletPattern = /^-\s+\*\*(\d{4}-\d{2}-\d{2})\*\*\s*\|\s*(.+?)\s*[—–-]\s*(.+)$/gm;
  let match;
  while ((match = bulletPattern.exec(content)) !== null) {
    entries.push({ slug, date: match[1], source: match[2].trim(), summary: match[3].trim() });
  }

  // Format 2: Header — ### YYYY-MM-DD — Title
  const headerPattern = /^###\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/gm;
  while ((match = headerPattern.exec(content)) !== null) {
    const afterIdx = match.index + match[0].length;
    const nextHeader = content.indexOf('\n### ', afterIdx);
    const nextSection = content.indexOf('\n## ', afterIdx);
    const endIdx = Math.min(
      nextHeader >= 0 ? nextHeader : content.length,
      nextSection >= 0 ? nextSection : content.length,
    );
    const detail = content.slice(afterIdx, endIdx).trim();
    entries.push({ slug, date: match[1], source: 'markdown', summary: match[2].trim(), detail: detail || undefined });
  }

  return entries;
}

// --- Main command ---

export async function runExtract(engine: BrainEngine, args: string[]) {
  const subcommand = args[0];
  const dirIdx = args.indexOf('--dir');
  // Support both --dir <path> flag and positional [dir] argument.
  // Positional dir is args[1] when it doesn't start with '--' (and --dir flag is absent).
  let brainDir: string;
  if (dirIdx >= 0 && dirIdx + 1 < args.length) {
    brainDir = args[dirIdx + 1];
  } else if (args[1] && !args[1].startsWith('--')) {
    brainDir = args[1];
  } else {
    brainDir = '.';
  }
  const dryRun = args.includes('--dry-run');
  const jsonMode = args.includes('--json');

  if (!subcommand || !['links', 'timeline', 'all'].includes(subcommand)) {
    console.error('Usage: gbrain extract <links|timeline|all> [--dir <brain-dir>] [--dry-run] [--json]');
    process.exit(1);
  }

  if (!existsSync(brainDir)) {
    console.error(`Directory not found: ${brainDir}`);
    process.exit(1);
  }

  const result: ExtractResult = { links_created: 0, timeline_entries_created: 0, pages_processed: 0 };

  if (subcommand === 'links' || subcommand === 'all') {
    const r = await extractLinksFromDir(engine, brainDir, dryRun, jsonMode);
    result.links_created = r.created;
    result.pages_processed = r.pages;
  }
  if (subcommand === 'timeline' || subcommand === 'all') {
    const r = await extractTimelineFromDir(engine, brainDir, dryRun, jsonMode);
    result.timeline_entries_created = r.created;
    result.pages_processed = Math.max(result.pages_processed, r.pages);
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!dryRun) {
    console.log(`\nDone: ${result.links_created} links, ${result.timeline_entries_created} timeline entries from ${result.pages_processed} pages`);
  }
}

async function extractLinksFromDir(
  engine: BrainEngine, brainDir: string, dryRun: boolean, jsonMode: boolean,
): Promise<{ created: number; pages: number }> {
  const files = walkMarkdownFiles(brainDir);
  const allSlugs = new Set(files.map(f => f.relPath.replace('.md', '')));

  // Load existing links for O(1) dedup
  const existing = new Set<string>();
  try {
    const pages = await engine.listPages({ limit: 100000 });
    for (const page of pages) {
      for (const link of await engine.getLinks(page.slug)) {
        existing.add(`${link.from_slug}::${link.to_slug}`);
      }
    }
  } catch { /* fresh brain */ }

  let created = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      const content = readFileSync(files[i].path, 'utf-8');
      const links = extractLinksFromFile(content, files[i].relPath, allSlugs);
      for (const link of links) {
        const key = `${link.from_slug}::${link.to_slug}`;
        if (existing.has(key)) continue;
        existing.add(key);
        if (dryRun) {
          if (!jsonMode) console.log(`  ${link.from_slug} → ${link.to_slug} (${link.link_type})`);
          created++;
        } else {
          try {
            await engine.addLink(link.from_slug, link.to_slug, link.context, link.link_type);
            created++;
          } catch { /* UNIQUE or page not found */ }
        }
      }
    } catch { /* skip unreadable */ }
    if (jsonMode && !dryRun && (i % 100 === 0 || i === files.length - 1)) {
      process.stderr.write(JSON.stringify({ event: 'progress', phase: 'extracting_links', done: i + 1, total: files.length }) + '\n');
    }
  }

  if (!jsonMode) {
    const label = dryRun ? '(dry run) would create' : 'created';
    console.log(`Links: ${label} ${created} from ${files.length} pages`);
  }
  return { created, pages: files.length };
}

async function extractTimelineFromDir(
  engine: BrainEngine, brainDir: string, dryRun: boolean, jsonMode: boolean,
): Promise<{ created: number; pages: number }> {
  const files = walkMarkdownFiles(brainDir);

  // Load existing timeline entries for O(1) dedup
  const existing = new Set<string>();
  try {
    const pages = await engine.listPages({ limit: 100000 });
    for (const page of pages) {
      for (const entry of await engine.getTimeline(page.slug)) {
        existing.add(`${page.slug}::${entry.date}::${entry.summary}`);
      }
    }
  } catch { /* fresh brain */ }

  let created = 0;
  for (let i = 0; i < files.length; i++) {
    try {
      const content = readFileSync(files[i].path, 'utf-8');
      const slug = files[i].relPath.replace('.md', '');
      for (const entry of extractTimelineFromContent(content, slug)) {
        const key = `${entry.slug}::${entry.date}::${entry.summary}`;
        if (existing.has(key)) continue;
        existing.add(key);
        if (dryRun) {
          if (!jsonMode) console.log(`  ${entry.slug}: ${entry.date} — ${entry.summary}`);
          created++;
        } else {
          try {
            await engine.addTimelineEntry(entry.slug, { date: entry.date, source: entry.source, summary: entry.summary, detail: entry.detail });
            created++;
          } catch { /* page not in DB or constraint */ }
        }
      }
    } catch { /* skip unreadable */ }
    if (jsonMode && !dryRun && (i % 100 === 0 || i === files.length - 1)) {
      process.stderr.write(JSON.stringify({ event: 'progress', phase: 'extracting_timeline', done: i + 1, total: files.length }) + '\n');
    }
  }

  if (!jsonMode) {
    const label = dryRun ? '(dry run) would create' : 'created';
    console.log(`Timeline: ${label} ${created} entries from ${files.length} pages`);
  }
  return { created, pages: files.length };
}

// --- Sync integration hooks ---

export async function extractLinksForSlugs(engine: BrainEngine, repoPath: string, slugs: string[]): Promise<number> {
  const allFiles = walkMarkdownFiles(repoPath);
  const allSlugs = new Set(allFiles.map(f => f.relPath.replace('.md', '')));
  let created = 0;
  for (const slug of slugs) {
    const filePath = join(repoPath, slug + '.md');
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      for (const link of extractLinksFromFile(content, slug + '.md', allSlugs)) {
        try { await engine.addLink(link.from_slug, link.to_slug, link.context, link.link_type); created++; } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return created;
}

export async function extractTimelineForSlugs(engine: BrainEngine, repoPath: string, slugs: string[]): Promise<number> {
  let created = 0;
  for (const slug of slugs) {
    const filePath = join(repoPath, slug + '.md');
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      for (const entry of extractTimelineFromContent(content, slug)) {
        try { await engine.addTimelineEntry(entry.slug, { date: entry.date, source: entry.source, summary: entry.summary, detail: entry.detail }); created++; } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return created;
}
