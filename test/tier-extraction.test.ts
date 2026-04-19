/**
 * Unit tests for MCP tier extraction.
 *
 * Covers:
 *   - `extractTierFromScopes` pure function: null/empty/no-tier/single/multiple
 *     entries, empty tier name, mixed-type arrays.
 *   - `resolveTierForRequest` env-var resolution order.
 *   - `lookupScopesByToken` against a mocked engine.sql template literal.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { BrainEngine } from '../src/core/engine.ts';
import {
  extractTierFromScopes,
  hashToken,
  lookupScopesByToken,
  resolveTierForRequest,
} from '../src/mcp/tier-extraction.ts';

// ─── extractTierFromScopes ────────────────────────────────────────

describe('extractTierFromScopes', () => {
  it('returns undefined when scopes is undefined', () => {
    expect(extractTierFromScopes(undefined)).toBeUndefined();
  });

  it('returns undefined when scopes is null', () => {
    expect(extractTierFromScopes(null)).toBeUndefined();
  });

  it('returns undefined when scopes is empty array', () => {
    expect(extractTierFromScopes([])).toBeUndefined();
  });

  it('returns undefined when no entry starts with tier:', () => {
    expect(extractTierFromScopes(['read', 'write', 'ops:write'])).toBeUndefined();
  });

  it('extracts a single tier name', () => {
    expect(extractTierFromScopes(['tier:family'])).toBe('family');
  });

  it('extracts a multi-word tier name (e.g. work_scoped)', () => {
    expect(extractTierFromScopes(['tier:work_scoped'])).toBe('work_scoped');
  });

  it('extracts tier from a mixed scopes array', () => {
    expect(
      extractTierFromScopes(['read', 'tier:family', 'ops:write']),
    ).toBe('family');
  });

  it('returns the first tier when multiple tier: entries exist and logs warning', () => {
    const warn = mock(() => {});
    const result = extractTierFromScopes(
      ['tier:family', 'tier:work_scoped'],
      { warn },
    );
    expect(result).toBe('family');
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('2 tier: entries');
    expect(msg).toContain('tier:family');
    expect(msg).toContain('tier:work_scoped');
  });

  it('does not log when logger is omitted even with multiple tier entries', () => {
    expect(() =>
      extractTierFromScopes(['tier:a', 'tier:b']),
    ).not.toThrow();
    expect(extractTierFromScopes(['tier:a', 'tier:b'])).toBe('a');
  });

  it('treats empty tier name "tier:" as absent', () => {
    expect(extractTierFromScopes(['tier:'])).toBeUndefined();
  });

  it('trims whitespace inside tier value', () => {
    // Defensive: "tier: family" with a rogue space should still yield "family".
    expect(extractTierFromScopes(['tier: family '])).toBe('family');
  });

  it('ignores non-string entries without throwing', () => {
    const scopes = ['read', null as unknown as string, 'tier:family', 42 as unknown as string];
    expect(extractTierFromScopes(scopes)).toBe('family');
  });
});

// ─── resolveTierForRequest ────────────────────────────────────────

describe('resolveTierForRequest', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GBRAIN_MCP_TIER;
    delete process.env.GBRAIN_MCP_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns undefined when no env vars are set', async () => {
    const engine = {} as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBeUndefined();
  });

  it('honors GBRAIN_MCP_TIER as a direct override', async () => {
    process.env.GBRAIN_MCP_TIER = 'family';
    const engine = {} as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBe('family');
  });

  it('trims whitespace in GBRAIN_MCP_TIER', async () => {
    process.env.GBRAIN_MCP_TIER = '  work_scoped  ';
    const engine = {} as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBe('work_scoped');
  });

  it('ignores empty GBRAIN_MCP_TIER and falls through to token lookup', async () => {
    process.env.GBRAIN_MCP_TIER = '';
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_deadbeef';
    // No engine.sql → undefined (graceful)
    const engine = {} as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBeUndefined();
  });

  it('prefers GBRAIN_MCP_TIER over GBRAIN_MCP_TOKEN when both are set', async () => {
    process.env.GBRAIN_MCP_TIER = 'full';
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_deadbeef';
    // sql would throw if called; the override must short-circuit.
    const engine = {
      sql: () => {
        throw new Error('should not be called');
      },
    } as unknown as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBe('full');
  });

  it('looks up scopes via engine.sql when only GBRAIN_MCP_TOKEN is set', async () => {
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_testtoken';

    const expectedHash = hashToken('gbrain_testtoken');
    let capturedHash: string | undefined;
    const fakeSql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedHash = values[0] as string;
      return Promise.resolve([{ scopes: ['read', 'tier:family'] }]);
    };
    const engine = { sql: fakeSql } as unknown as BrainEngine;

    const tier = await resolveTierForRequest(engine);
    expect(capturedHash).toBe(expectedHash);
    expect(tier).toBe('family');
  });

  it('returns undefined when token lookup finds no row', async () => {
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_unknown';
    const fakeSql = () => Promise.resolve([]);
    const engine = { sql: fakeSql } as unknown as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBeUndefined();
  });

  it('returns undefined when row has no tier: scope', async () => {
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_no_tier';
    const fakeSql = () =>
      Promise.resolve([{ scopes: ['read', 'ops:write'] }]);
    const engine = { sql: fakeSql } as unknown as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBeUndefined();
  });

  it('returns undefined when engine has no sql property (e.g. PGLite)', async () => {
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_anything';
    const warn = mock(() => {});
    const engine = {} as BrainEngine;
    expect(await resolveTierForRequest(engine, { warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0][0] as string).toLowerCase()).toContain(
      'does not support access_tokens',
    );
  });

  it('returns undefined (and warns) when DB throws', async () => {
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_dberror';
    const fakeSql = () => Promise.reject(new Error('connection refused'));
    const engine = { sql: fakeSql } as unknown as BrainEngine;
    const warn = mock(() => {});
    expect(await resolveTierForRequest(engine, { warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0] as string).toContain('connection refused');
  });

  it('handles a NULL scopes column as empty array', async () => {
    process.env.GBRAIN_MCP_TOKEN = 'gbrain_null_scopes';
    const fakeSql = () => Promise.resolve([{ scopes: null }]);
    const engine = { sql: fakeSql } as unknown as BrainEngine;
    expect(await resolveTierForRequest(engine)).toBeUndefined();
  });
});

// ─── lookupScopesByToken ──────────────────────────────────────────

describe('lookupScopesByToken', () => {
  it('returns undefined when engine has no sql', async () => {
    const engine = {} as BrainEngine;
    expect(await lookupScopesByToken(engine, 'token')).toBeUndefined();
  });

  it('hashes the token before querying', async () => {
    let captured: string | undefined;
    const fakeSql = (_strings: TemplateStringsArray, ...values: unknown[]) => {
      captured = values[0] as string;
      return Promise.resolve([{ scopes: ['tier:full'] }]);
    };
    const engine = { sql: fakeSql } as unknown as BrainEngine;
    const scopes = await lookupScopesByToken(engine, 'gbrain_raw');
    expect(captured).toBe(hashToken('gbrain_raw'));
    expect(scopes).toEqual(['tier:full']);
  });

  it('returns [] when row exists but scopes is NULL', async () => {
    const fakeSql = () => Promise.resolve([{ scopes: null }]);
    const engine = { sql: fakeSql } as unknown as BrainEngine;
    expect(await lookupScopesByToken(engine, 'tok')).toEqual([]);
  });
});

// ─── hashToken sanity ─────────────────────────────────────────────

describe('hashToken', () => {
  it('produces a hex SHA-256 string of 64 chars', () => {
    const h = hashToken('anything');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });
});
