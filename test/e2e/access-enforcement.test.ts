/**
 * E2E Access Enforcement Tests
 *
 * Verifies that ctx.tier + GBRAIN_ACCESS_TIERS_PATH together produce
 * actual filtering against a real Postgres engine.
 *
 * Skips gracefully when DATABASE_URL is not configured.
 *
 * Run: DATABASE_URL=... bun test test/e2e/access-enforcement.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hasDatabase, setupDB, teardownDB, getEngine } from './helpers.ts';
import { operationsByName } from '../../src/core/operations.ts';
import type { OperationContext } from '../../src/core/operations.ts';
import { clearAccessContextCache } from '../../src/core/access-context.ts';
import { importFromContent } from '../../src/core/import-file.ts';

const skip = !hasDatabase();
const describeE2E = skip ? describe.skip : describe;

let tmpDir: string;
let tiersPath: string;

function writeTiersConfig() {
  tmpDir = mkdtempSync(join(tmpdir(), 'gbrain-e2e-access-'));
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
    description: "family visibility — personal only, no finance"
    allow_tags: ["domain:personal"]
    block_tags: ["domain:finance", "domain:identity"]
  none:
    description: "deny all"
    allow_tags: []
    block_tags: ["*"]
`,
  );
  process.env.GBRAIN_ACCESS_TIERS_PATH = tiersPath;
  clearAccessContextCache();
}

function makeCtx(tier?: string): OperationContext {
  return {
    engine: getEngine(),
    config: { engine: 'postgres', database_url: process.env.DATABASE_URL! },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: false,
    remote: false,
    tier,
  };
}

async function callOp(name: string, params: Record<string, unknown> = {}, tier?: string) {
  const op = operationsByName[name];
  if (!op) throw new Error(`Unknown operation: ${name}`);
  return op.handler(makeCtx(tier), params);
}

describeE2E('E2E: Access enforcement', () => {
  beforeAll(async () => {
    await setupDB();
    const e = getEngine();

    // Seed 3 tagged pages, each in a distinct sensitivity domain
    await importFromContent(
      e,
      'personal/vacation-notes',
      `---
type: concept
title: Vacation notes
tags:
  - domain:personal
---

Trip ideas for next summer.
`,
      { noEmbed: true },
    );

    await importFromContent(
      e,
      'finance/retirement-plan',
      `---
type: concept
title: Retirement plan
tags:
  - domain:finance
---

FIRE target details.
`,
      { noEmbed: true },
    );

    await importFromContent(
      e,
      'identity/passport',
      `---
type: concept
title: Passport
tags:
  - domain:identity
---

Passport info.
`,
      { noEmbed: true },
    );

    writeTiersConfig();
  });

  afterAll(async () => {
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
    clearAccessContextCache();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    await teardownDB();
  });

  test('list_pages: tier=full sees all three', async () => {
    const pages = await callOp('list_pages', {}, 'full') as any[];
    const slugs = pages.map((p) => p.slug).sort();
    expect(slugs).toContain('personal/vacation-notes');
    expect(slugs).toContain('finance/retirement-plan');
    expect(slugs).toContain('identity/passport');
  });

  test('list_pages: tier=family sees only personal', async () => {
    const pages = await callOp('list_pages', {}, 'family') as any[];
    const slugs = pages.map((p) => p.slug);
    expect(slugs).toContain('personal/vacation-notes');
    expect(slugs).not.toContain('finance/retirement-plan');
    expect(slugs).not.toContain('identity/passport');
  });

  test('list_pages: tier=none sees nothing', async () => {
    const pages = await callOp('list_pages', {}, 'none') as any[];
    expect(pages.length).toBe(0);
  });

  test('list_pages: no tier (backwards compat) returns all', async () => {
    const pages = await callOp('list_pages', {}) as any[];
    const slugs = pages.map((p) => p.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(3);
  });

  test('get_page: tier=family can read personal page', async () => {
    const page = await callOp(
      'get_page',
      { slug: 'personal/vacation-notes' },
      'family',
    ) as any;
    expect(page.slug).toBe('personal/vacation-notes');
  });

  test('get_page: tier=family cannot read finance page', async () => {
    await expect(
      callOp('get_page', { slug: 'finance/retirement-plan' }, 'family'),
    ).rejects.toThrow(/not found/i);
  });

  test('get_page: tier=none cannot read anything', async () => {
    await expect(
      callOp('get_page', { slug: 'personal/vacation-notes' }, 'none'),
    ).rejects.toThrow(/not found/i);
  });

  test('get_tags: tier=family gets empty tags for hidden page', async () => {
    const tags = await callOp(
      'get_tags',
      { slug: 'finance/retirement-plan' },
      'family',
    ) as string[];
    expect(tags).toEqual([]);
  });

  test('get_tags: tier=family sees tags for visible page', async () => {
    const tags = await callOp(
      'get_tags',
      { slug: 'personal/vacation-notes' },
      'family',
    ) as string[];
    expect(tags).toContain('domain:personal');
  });

  test('get_chunks: tier=family gets empty chunks for hidden page', async () => {
    const chunks = await callOp(
      'get_chunks',
      { slug: 'finance/retirement-plan' },
      'family',
    ) as any[];
    expect(chunks).toEqual([]);
  });

  test('search: tier=family sees only personal results', async () => {
    // Keyword search for a term that's present across domains
    const results = await callOp('search', { query: 'plan' }, 'family') as any[];
    const slugs = results.map((r) => r.slug);
    expect(slugs).not.toContain('finance/retirement-plan');
    expect(slugs).not.toContain('identity/passport');
  });
});
