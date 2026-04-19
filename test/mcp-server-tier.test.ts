/**
 * Integration test for MCP server tier plumbing.
 *
 * Verifies that `startMcpServer` resolves the tier once from env vars and
 * that the resulting `OperationContext.tier` flows into operation handlers.
 *
 * We avoid spinning up the real stdio transport — the contract under test is
 * "the server builds ctx with ctx.tier derived from env + access_tokens" — so
 * we intercept `setRequestHandler` by stubbing the MCP SDK Server class via
 * the transport we pass. Instead of that plumbing we exercise the tier
 * resolver directly against a fake engine and then hand-assemble a ctx that
 * mirrors what server.ts builds, asserting the filter pipeline applies.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAccessContextCache } from '../src/core/access-context.ts';
import type { BrainEngine } from '../src/core/engine.ts';
import { operationsByName } from '../src/core/operations.ts';
import type { OperationContext } from '../src/core/operations.ts';
import type {
  Chunk, Link, Page, SearchResult, TimelineEntry,
} from '../src/core/types.ts';
import {
  hashToken,
  resolveTierForRequest,
} from '../src/mcp/tier-extraction.ts';

interface MockPage extends Page {
  tags: string[];
}

class MockEngine implements Partial<BrainEngine> {
  pages = new Map<string, MockPage>();

  // Scopes table keyed by token_hash; emulates the access_tokens row shape.
  scopesByHash = new Map<string, string[]>();

  addPage(p: { slug: string; tags?: string[]; type?: string }) {
    this.pages.set(p.slug, {
      id: this.pages.size + 1,
      slug: p.slug,
      type: (p.type as any) || 'concept',
      title: p.slug,
      compiled_truth: '',
      timeline: '',
      frontmatter: {},
      created_at: new Date(),
      updated_at: new Date(),
      tags: p.tags || [],
    });
  }

  // Stand in for the `postgres` tagged-template function.
  sql = async (
    _strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Array<{ scopes: string[] | null }>> => {
    const hash = values[0] as string;
    const scopes = this.scopesByHash.get(hash);
    if (!scopes) return [];
    return [{ scopes }];
  };

  async getPage(slug: string): Promise<Page | null> {
    return this.pages.get(slug) ?? null;
  }
  async resolveSlugs(): Promise<string[]> { return []; }
  async getTags(slug: string): Promise<string[]> {
    return this.pages.get(slug)?.tags ?? [];
  }
  async listPages(): Promise<Page[]> {
    return [...this.pages.values()];
  }
  async searchKeyword(): Promise<SearchResult[]> { return []; }
  async searchVector(): Promise<SearchResult[]> { return []; }
  async getEmbeddingsByChunkIds(): Promise<Map<number, Float32Array>> {
    return new Map();
  }
  async getLinks(): Promise<Link[]> { return []; }
  async getBacklinks(): Promise<Link[]> { return []; }
  async getTimeline(): Promise<TimelineEntry[]> { return []; }
  async getChunks(): Promise<Chunk[]> { return []; }
}

let tmpDir = '';
let tiersPath = '';

function writeTiersConfig(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'gbrain-mcp-tier-'));
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
    block_tags: ["domain:finance"]
`,
  );
  process.env.GBRAIN_ACCESS_TIERS_PATH = tiersPath;
}

function cleanup(): void {
  delete process.env.GBRAIN_ACCESS_TIERS_PATH;
  delete process.env.GBRAIN_ACCESS_TIERS_OVERLAY_PATH;
  delete process.env.GBRAIN_MCP_TIER;
  delete process.env.GBRAIN_MCP_TOKEN;
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
}

function buildMcpCtx(engine: MockEngine, tier: string | undefined): OperationContext {
  // Mirrors the ctx shape built inside startMcpServer.
  return {
    engine: engine as unknown as BrainEngine,
    config: { engine: 'postgres', database_url: 'x' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: false,
    remote: true,
    tier,
  };
}

describe('MCP server tier plumbing', () => {
  beforeEach(() => {
    clearAccessContextCache();
    cleanup();
  });
  afterEach(cleanup);

  it('resolves tier via GBRAIN_MCP_TIER and filters list_pages', async () => {
    writeTiersConfig();
    process.env.GBRAIN_MCP_TIER = 'family';

    const engine = new MockEngine();
    engine.addPage({ slug: 'personal/note', tags: ['domain:personal'] });
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });

    const tier = await resolveTierForRequest(engine as unknown as BrainEngine);
    expect(tier).toBe('family');

    const ctx = buildMcpCtx(engine, tier);
    const pages = await operationsByName.list_pages.handler(ctx, {}) as Page[];
    const slugs = pages.map((p) => p.slug).sort();
    expect(slugs).toEqual(['personal/note']);
  });

  it('resolves tier via GBRAIN_MCP_TOKEN + access_tokens.scopes lookup', async () => {
    writeTiersConfig();
    const rawToken = 'gbrain_mcptesttoken';
    process.env.GBRAIN_MCP_TOKEN = rawToken;

    const engine = new MockEngine();
    engine.scopesByHash.set(hashToken(rawToken), ['read', 'tier:family']);
    engine.addPage({ slug: 'personal/note', tags: ['domain:personal'] });
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });

    const tier = await resolveTierForRequest(engine as unknown as BrainEngine);
    expect(tier).toBe('family');

    const ctx = buildMcpCtx(engine, tier);

    // get_page on a blocked slug should behave as not-found under tier rules.
    await expect(
      operationsByName.get_page.handler(ctx, { slug: 'finance/secret' }),
    ).rejects.toThrow(/not found/i);

    // get_page on an allowed slug should return the page.
    const ok = await operationsByName.get_page.handler(ctx, {
      slug: 'personal/note',
    }) as Page;
    expect(ok.slug).toBe('personal/note');
  });

  it('leaves tier unset (backwards compatible) when no env vars and no token', async () => {
    // Explicitly: no env vars and no tiers config → ctx.tier undefined → no filtering.
    const engine = new MockEngine();
    engine.addPage({ slug: 'personal/note', tags: ['domain:personal'] });
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });

    const tier = await resolveTierForRequest(engine as unknown as BrainEngine);
    expect(tier).toBeUndefined();

    const ctx = buildMcpCtx(engine, tier);
    const pages = await operationsByName.list_pages.handler(ctx, {}) as Page[];
    // Both pages returned — no filtering applied.
    expect(pages.length).toBe(2);
  });

  it('leaves tier unset when GBRAIN_MCP_TOKEN is set but token is unknown', async () => {
    writeTiersConfig();
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_unknown_token';

    const engine = new MockEngine();
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });

    const tier = await resolveTierForRequest(engine as unknown as BrainEngine);
    expect(tier).toBeUndefined();

    const ctx = buildMcpCtx(engine, tier);
    const pages = await operationsByName.list_pages.handler(ctx, {}) as Page[];
    // No tier → no filtering even though a tiers config is loaded.
    expect(pages.map((p) => p.slug)).toContain('finance/secret');
  });

  it('leaves tier unset when scopes has no tier: entry', async () => {
    writeTiersConfig();
    const rawToken = 'gbrain_notier_token';
    process.env.GBRAIN_MCP_TOKEN = rawToken;

    const engine = new MockEngine();
    engine.scopesByHash.set(hashToken(rawToken), ['read', 'ops:write']);
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });

    const tier = await resolveTierForRequest(engine as unknown as BrainEngine);
    expect(tier).toBeUndefined();

    const ctx = buildMcpCtx(engine, tier);
    const pages = await operationsByName.list_pages.handler(ctx, {}) as Page[];
    expect(pages.length).toBe(1);
  });

  it('applies the first tier when scopes has multiple tier: entries', async () => {
    writeTiersConfig();
    const rawToken = 'gbrain_multi_tier_token';
    process.env.GBRAIN_MCP_TOKEN = rawToken;

    const engine = new MockEngine();
    // Stacked tier entries: first wins per the documented policy.
    engine.scopesByHash.set(hashToken(rawToken), ['tier:family', 'tier:full']);
    engine.addPage({ slug: 'personal/note', tags: ['domain:personal'] });
    engine.addPage({ slug: 'finance/secret', tags: ['domain:finance'] });

    const tier = await resolveTierForRequest(engine as unknown as BrainEngine);
    expect(tier).toBe('family');

    const ctx = buildMcpCtx(engine, tier);
    const pages = await operationsByName.list_pages.handler(ctx, {}) as Page[];
    const slugs = pages.map((p) => p.slug).sort();
    expect(slugs).toEqual(['personal/note']); // family tier → finance blocked
  });
});
