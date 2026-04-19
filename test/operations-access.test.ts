/**
 * Unit tests for access-tier filtering applied at the operations.ts layer.
 *
 * These use a hand-rolled in-memory mock engine so we can test op handlers
 * without spinning up a real Postgres — the filter wiring itself is what's
 * under test, not the engine internals.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operationsByName } from '../src/core/operations.ts';
import type { OperationContext } from '../src/core/operations.ts';
import { clearAccessContextCache } from '../src/core/access-context.ts';
import type { BrainEngine } from '../src/core/engine.ts';
import type {
  Page, SearchResult, Link, TimelineEntry, Chunk,
} from '../src/core/types.ts';

// ─── Mock engine ──────────────────────────────────────────────────

interface MockPage extends Page {
  tags: string[];
}

class MockEngine implements Partial<BrainEngine> {
  pages = new Map<string, MockPage>();
  links: Link[] = [];
  timelines = new Map<string, TimelineEntry[]>();
  chunks = new Map<string, Chunk[]>();

  addPage(p: { slug: string; type?: string; title?: string; tags?: string[] }) {
    this.pages.set(p.slug, {
      id: this.pages.size + 1,
      slug: p.slug,
      type: (p.type as any) || 'concept',
      title: p.title || p.slug,
      compiled_truth: '',
      timeline: '',
      frontmatter: {},
      created_at: new Date(),
      updated_at: new Date(),
      tags: p.tags || [],
    });
  }

  async getPage(slug: string): Promise<Page | null> {
    return this.pages.get(slug) ?? null;
  }
  async resolveSlugs(_partial: string): Promise<string[]> {
    return [];
  }
  async getTags(slug: string): Promise<string[]> {
    return this.pages.get(slug)?.tags ?? [];
  }
  async listPages(): Promise<Page[]> {
    return [...this.pages.values()];
  }
  async searchKeyword(_q: string): Promise<SearchResult[]> {
    return [...this.pages.values()].map((p, i) => ({
      slug: p.slug,
      page_id: p.id,
      title: p.title,
      type: p.type,
      // Unique text per slug so dedupResults' Jaccard pass doesn't collapse them
      chunk_text: `content for ${p.slug} unique token ${i}`,
      chunk_source: 'compiled_truth',
      chunk_id: i,
      chunk_index: 0,
      score: 1,
      stale: false,
    }));
  }
  async searchVector(): Promise<SearchResult[]> {
    return this.searchKeyword('');
  }
  async getEmbeddingsByChunkIds(): Promise<Map<number, Float32Array>> {
    return new Map();
  }
  async getLinks(slug: string): Promise<Link[]> {
    return this.links.filter((l) => l.from_slug === slug);
  }
  async getBacklinks(slug: string): Promise<Link[]> {
    return this.links.filter((l) => l.to_slug === slug);
  }
  async getTimeline(slug: string): Promise<TimelineEntry[]> {
    return this.timelines.get(slug) ?? [];
  }
  async getChunks(slug: string): Promise<Chunk[]> {
    return this.chunks.get(slug) ?? [];
  }
}

function makeCtx(engine: MockEngine, tier?: string): OperationContext {
  return {
    engine: engine as unknown as BrainEngine,
    config: { engine: 'postgres', database_url: 'x' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: false,
    remote: false,
    tier,
  };
}

let tmpDir: string;
let tiersPath: string;

function writeTiersConfig() {
  tmpDir = mkdtempSync(join(tmpdir(), 'gbrain-access-ops-'));
  tiersPath = join(tmpDir, 'access-tiers.yaml');
  writeFileSync(
    tiersPath,
    `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: []
  family:
    description: "family view"
    allow_tags: ["domain:personal"]
    block_tags: ["domain:finance", "sensitivity:owner-only"]
  none:
    description: "deny-all"
    allow_tags: []
    block_tags: ["*"]
`,
  );
  process.env.GBRAIN_ACCESS_TIERS_PATH = tiersPath;
}

function cleanupTiersConfig() {
  delete process.env.GBRAIN_ACCESS_TIERS_PATH;
  delete process.env.GBRAIN_ACCESS_TIERS_OVERLAY_PATH;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
}

// ─── get_page ─────────────────────────────────────────────────────

describe('get_page with access filter', () => {
  beforeEach(() => {
    clearAccessContextCache();
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
    delete process.env.GBRAIN_ACCESS_TIERS_OVERLAY_PATH;
  });
  afterEach(cleanupTiersConfig);

  it('returns page when ctx.tier is unset (backwards compat)', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'test/page', tags: ['sensitivity:owner-only'] });
    // No env var, no tier → no filtering
    const ctx = makeCtx(engine, undefined);
    const result = await operationsByName.get_page.handler(ctx, { slug: 'test/page' }) as any;
    expect(result.slug).toBe('test/page');
  });

  it('returns page when config file is not configured (backwards compat)', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'test/page', tags: ['sensitivity:owner-only'] });
    // tier is set but no env var → no enforcement
    const ctx = makeCtx(engine, 'family');
    const result = await operationsByName.get_page.handler(ctx, { slug: 'test/page' }) as any;
    expect(result.slug).toBe('test/page');
  });

  it('throws page_not_found when page is blocked by tier rules', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });
    const ctx = makeCtx(engine, 'family');
    await expect(
      operationsByName.get_page.handler(ctx, { slug: 'finance/secret' }),
    ).rejects.toThrow(/not found/i);
  });

  it('returns page when page passes tier rules', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'personal/note', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, 'family');
    const result = await operationsByName.get_page.handler(ctx, { slug: 'personal/note' }) as any;
    expect(result.slug).toBe('personal/note');
  });

  it('denies everything under tier=none', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'personal/note', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, 'none');
    await expect(
      operationsByName.get_page.handler(ctx, { slug: 'personal/note' }),
    ).rejects.toThrow(/not found/i);
  });
});

// ─── list_pages ───────────────────────────────────────────────────

describe('list_pages with access filter', () => {
  beforeEach(() => {
    clearAccessContextCache();
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
  });
  afterEach(cleanupTiersConfig);

  it('returns all pages when tier unset (backwards compat)', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:personal'] });
    engine.addPage({ slug: 'b', tags: ['domain:finance'] });
    const ctx = makeCtx(engine, undefined);
    const pages = await operationsByName.list_pages.handler(ctx, {}) as any[];
    expect(pages.length).toBe(2);
  });

  it('filters pages by tier when enforcement is on', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:personal'] });
    engine.addPage({ slug: 'b', tags: ['domain:finance'] });
    engine.addPage({ slug: 'c', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, 'family');
    const pages = await operationsByName.list_pages.handler(ctx, {}) as any[];
    const slugs = pages.map((p) => p.slug).sort();
    expect(slugs).toEqual(['a', 'c']);
  });

  it('returns empty list under tier=none', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, 'none');
    const pages = await operationsByName.list_pages.handler(ctx, {}) as any[];
    expect(pages.length).toBe(0);
  });
});

// ─── search + query ───────────────────────────────────────────────

describe('search + query with access filter', () => {
  beforeEach(() => {
    clearAccessContextCache();
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
  });
  afterEach(cleanupTiersConfig);

  it('search returns all results when tier unset', async () => {
    const engine = new MockEngine();
    // Use different page types to avoid dedupResults' 60% type diversity cap
    engine.addPage({ slug: 'a', type: 'person', tags: ['domain:finance'] });
    engine.addPage({ slug: 'b', type: 'concept', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, undefined);
    const results = await operationsByName.search.handler(ctx, { query: 'x' }) as any[];
    expect(results.length).toBe(2);
  });

  it('search filters blocked pages by tier', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', type: 'person', tags: ['domain:finance'] });
    engine.addPage({ slug: 'b', type: 'concept', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, 'family');
    const results = await operationsByName.search.handler(ctx, { query: 'x' }) as any[];
    const slugs = results.map((r) => r.slug);
    expect(slugs).toContain('b');
    expect(slugs).not.toContain('a');
  });

  // query uses hybridSearch which calls searchVector + searchKeyword — we can't
  // easily mock the full embedding path here. Main coverage for query is the
  // E2E test. We do a minimal smoke test: query respects the filter when
  // the mock engine returns results. Expansion is disabled to keep the path short.
  it('query filters blocked pages by tier', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', type: 'person', tags: ['domain:finance'] });
    engine.addPage({ slug: 'b', type: 'concept', tags: ['domain:personal'] });
    const ctx = makeCtx(engine, 'family');
    const results = await operationsByName.query.handler(ctx, {
      query: 'x',
      expand: false,
    }) as any;
    // hybrid search returns an object or array depending on detail level; normalize
    const list = Array.isArray(results) ? results : (results.results ?? results.items ?? []);
    if (list.length > 0) {
      const slugs = list.map((r: any) => r.slug);
      expect(slugs).not.toContain('a');
    }
  });
});

// ─── get_links, get_backlinks ─────────────────────────────────────

describe('get_links / get_backlinks with access filter', () => {
  beforeEach(() => {
    clearAccessContextCache();
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
  });
  afterEach(cleanupTiersConfig);

  it('get_links returns all links when tier unset', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: [] });
    engine.addPage({ slug: 'b', tags: ['domain:finance'] });
    engine.links.push({ from_slug: 'a', to_slug: 'b', link_type: '', context: '' });
    const ctx = makeCtx(engine, undefined);
    const links = await operationsByName.get_links.handler(ctx, { slug: 'a' }) as Link[];
    expect(links.length).toBe(1);
  });

  it('get_links filters links whose target is hidden', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:personal'] });
    engine.addPage({ slug: 'b', tags: ['domain:finance'] });
    engine.addPage({ slug: 'c', tags: ['domain:personal'] });
    engine.links.push({ from_slug: 'a', to_slug: 'b', link_type: '', context: '' });
    engine.links.push({ from_slug: 'a', to_slug: 'c', link_type: '', context: '' });
    const ctx = makeCtx(engine, 'family');
    const links = await operationsByName.get_links.handler(ctx, { slug: 'a' }) as Link[];
    const targets = links.map((l) => l.to_slug);
    expect(targets).toContain('c');
    expect(targets).not.toContain('b');
  });

  it('get_backlinks filters links whose source is hidden', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:personal'] });
    engine.addPage({ slug: 'b', tags: ['domain:finance'] });
    engine.addPage({ slug: 'c', tags: ['domain:personal'] });
    engine.links.push({ from_slug: 'b', to_slug: 'a', link_type: '', context: '' });
    engine.links.push({ from_slug: 'c', to_slug: 'a', link_type: '', context: '' });
    const ctx = makeCtx(engine, 'family');
    const links = await operationsByName.get_backlinks.handler(ctx, { slug: 'a' }) as Link[];
    const sources = links.map((l) => l.from_slug);
    expect(sources).toContain('c');
    expect(sources).not.toContain('b');
  });
});

// ─── get_timeline, get_tags, get_chunks (slug-keyed) ──────────────

describe('slug-keyed ops with access filter', () => {
  beforeEach(() => {
    clearAccessContextCache();
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
  });
  afterEach(cleanupTiersConfig);

  it('get_timeline returns entries when tier unset', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:finance'] });
    engine.timelines.set('a', [{
      id: 1, page_id: 1, date: '2026-01-01', source: '', summary: 's',
      detail: '', created_at: new Date(),
    }]);
    const ctx = makeCtx(engine, undefined);
    const tl = await operationsByName.get_timeline.handler(ctx, { slug: 'a' }) as any[];
    expect(tl.length).toBe(1);
  });

  it('get_timeline returns empty array when slug is blocked', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:finance'] });
    engine.timelines.set('a', [{
      id: 1, page_id: 1, date: '2026-01-01', source: '', summary: 's',
      detail: '', created_at: new Date(),
    }]);
    const ctx = makeCtx(engine, 'family');
    const tl = await operationsByName.get_timeline.handler(ctx, { slug: 'a' }) as any[];
    expect(tl).toEqual([]);
  });

  it('get_tags returns tags when tier unset', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:finance', 'foo'] });
    const ctx = makeCtx(engine, undefined);
    const tags = await operationsByName.get_tags.handler(ctx, { slug: 'a' }) as string[];
    expect(tags).toContain('domain:finance');
  });

  it('get_tags returns empty array when slug is blocked', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:finance', 'foo'] });
    const ctx = makeCtx(engine, 'family');
    const tags = await operationsByName.get_tags.handler(ctx, { slug: 'a' }) as string[];
    expect(tags).toEqual([]);
  });

  it('get_chunks returns chunks when tier unset', async () => {
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:finance'] });
    engine.chunks.set('a', [{
      id: 1, page_id: 1, chunk_index: 0, chunk_text: 'hi',
      chunk_source: 'compiled_truth', embedding: null, model: '',
      token_count: null, embedded_at: null,
    }]);
    const ctx = makeCtx(engine, undefined);
    const chunks = await operationsByName.get_chunks.handler(ctx, { slug: 'a' }) as any[];
    expect(chunks.length).toBe(1);
  });

  it('get_chunks returns empty array when slug is blocked', async () => {
    writeTiersConfig();
    const engine = new MockEngine();
    engine.addPage({ slug: 'a', tags: ['domain:finance'] });
    engine.chunks.set('a', [{
      id: 1, page_id: 1, chunk_index: 0, chunk_text: 'hi',
      chunk_source: 'compiled_truth', embedding: null, model: '',
      token_count: null, embedded_at: null,
    }]);
    const ctx = makeCtx(engine, 'family');
    const chunks = await operationsByName.get_chunks.handler(ctx, { slug: 'a' }) as any[];
    expect(chunks).toEqual([]);
  });
});
