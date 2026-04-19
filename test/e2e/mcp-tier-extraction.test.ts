/**
 * E2E: MCP tier extraction against real Postgres.
 *
 * Seeds an access_tokens row with a `tier:<name>` scope, then exercises the
 * resolver against the live engine and verifies a read op honors the tier.
 *
 * Skips gracefully when DATABASE_URL is not configured.
 *
 * Run: DATABASE_URL=... bun test test/e2e/mcp-tier-extraction.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAccessContextCache } from '../../src/core/access-context.ts';
import { importFromContent } from '../../src/core/import-file.ts';
import { operationsByName } from '../../src/core/operations.ts';
import type { OperationContext } from '../../src/core/operations.ts';
import {
  hashToken,
  resolveTierForRequest,
} from '../../src/mcp/tier-extraction.ts';
import { getConn, getEngine, hasDatabase, setupDB, teardownDB } from './helpers.ts';

const skip = !hasDatabase();
const describeE2E = skip ? describe.skip : describe;

let tmpDir = '';
let tiersPath = '';

function writeTiersConfig(): void {
  tmpDir = mkdtempSync(join(tmpdir(), 'gbrain-e2e-mcp-tier-'));
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
    description: "family"
    allow_tags: ["domain:personal"]
    block_tags: ["domain:finance"]
`,
  );
  process.env.GBRAIN_ACCESS_TIERS_PATH = tiersPath;
  clearAccessContextCache();
}

function buildCtx(tier: string | undefined): OperationContext {
  return {
    engine: getEngine(),
    config: { engine: 'postgres', database_url: process.env.DATABASE_URL! },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: false,
    remote: true,
    tier,
  };
}

describeE2E('E2E: MCP tier extraction', () => {
  beforeAll(async () => {
    await setupDB();
    const e = getEngine();

    await importFromContent(
      e,
      'personal/allowed',
      `---
type: concept
title: Allowed
tags:
  - domain:personal
---

Visible to family.
`,
      { noEmbed: true },
    );
    await importFromContent(
      e,
      'finance/blocked',
      `---
type: concept
title: Blocked
tags:
  - domain:finance
---

Hidden from family.
`,
      { noEmbed: true },
    );

    writeTiersConfig();

    // Seed access_tokens rows. The table may or may not have rows from prior
    // runs; we insert with unique names to avoid collisions and clean up after.
    const conn = getConn();
    await conn.unsafe(`DELETE FROM access_tokens WHERE name LIKE 'tier-ext-test-%'`);
  });

  afterAll(async () => {
    const conn = getConn();
    try {
      await conn.unsafe(`DELETE FROM access_tokens WHERE name LIKE 'tier-ext-test-%'`);
    } catch {
      // Non-fatal cleanup.
    }
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
    delete process.env.GBRAIN_MCP_TIER;
    delete process.env.GBRAIN_MCP_TOKEN;
    clearAccessContextCache();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    await teardownDB();
  });

  test('resolves tier from access_tokens.scopes and filters list_pages', async () => {
    const rawToken = 'gbrain_tierext_family_token';
    const hash = hashToken(rawToken);
    const conn = getConn();
    await conn`
      INSERT INTO access_tokens (name, token_hash, scopes)
      VALUES ('tier-ext-test-family', ${hash}, ${['read', 'tier:family']})
    `;

    process.env.GBRAIN_MCP_TOKEN = rawToken;
    delete process.env.GBRAIN_MCP_TIER;

    const tier = await resolveTierForRequest(getEngine());
    expect(tier).toBe('family');

    const pages = await operationsByName.list_pages.handler(
      buildCtx(tier),
      {},
    ) as Array<{ slug: string }>;
    const slugs = pages.map((p) => p.slug);
    expect(slugs).toContain('personal/allowed');
    expect(slugs).not.toContain('finance/blocked');
  });

  test('returns undefined when token is revoked', async () => {
    const rawToken = 'gbrain_tierext_revoked_token';
    const hash = hashToken(rawToken);
    const conn = getConn();
    await conn`
      INSERT INTO access_tokens (name, token_hash, scopes, revoked_at)
      VALUES ('tier-ext-test-revoked', ${hash}, ${['tier:family']}, now())
    `;

    process.env.GBRAIN_MCP_TOKEN = rawToken;
    const tier = await resolveTierForRequest(getEngine());
    expect(tier).toBeUndefined();
  });

  test('returns undefined when no tier: scope is present', async () => {
    const rawToken = 'gbrain_tierext_no_tier_token';
    const hash = hashToken(rawToken);
    const conn = getConn();
    await conn`
      INSERT INTO access_tokens (name, token_hash, scopes)
      VALUES ('tier-ext-test-no-tier', ${hash}, ${['read']})
    `;

    process.env.GBRAIN_MCP_TOKEN = rawToken;
    const tier = await resolveTierForRequest(getEngine());
    expect(tier).toBeUndefined();
  });

  test('GBRAIN_MCP_TIER direct override wins over token', async () => {
    const rawToken = 'gbrain_tierext_override_token';
    const hash = hashToken(rawToken);
    const conn = getConn();
    await conn`
      INSERT INTO access_tokens (name, token_hash, scopes)
      VALUES ('tier-ext-test-override', ${hash}, ${['tier:family']})
    `;

    process.env.GBRAIN_MCP_TOKEN = rawToken;
    process.env.GBRAIN_MCP_TIER = 'full';
    const tier = await resolveTierForRequest(getEngine());
    expect(tier).toBe('full');

    // full tier → both pages visible
    const pages = await operationsByName.list_pages.handler(
      buildCtx(tier),
      {},
    ) as Array<{ slug: string }>;
    const slugs = pages.map((p) => p.slug);
    expect(slugs).toContain('personal/allowed');
    expect(slugs).toContain('finance/blocked');

    delete process.env.GBRAIN_MCP_TIER;
  });
});
