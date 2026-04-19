/**
 * Tier extraction for MCP requests.
 *
 * The `access_tokens.scopes` column is a free-form text[] that may carry
 * auxiliary permission hints alongside a tier binding. This module extracts
 * a `tier:<name>` entry (e.g. `tier:family`, `tier:work_scoped`) and returns
 * the bare tier name for plumbing into `OperationContext.tier`.
 *
 * Design:
 *   - Pure extraction function (no I/O, no DB).
 *   - A separate async resolver queries `access_tokens` by SHA-256 of a bearer
 *     token and returns the tier. Used by the stdio server and available for
 *     reuse by external HTTP wrappers that front `gbrain serve`.
 *   - Multiple `tier:` entries: first wins; a warning is logged. This is a
 *     deliberate "fail-open to least-privilege-not-applied" choice — throwing
 *     on misconfiguration would take the brain offline whenever operator
 *     mis-tagged a token, which is worse than logging. The first-wins order
 *     makes the behavior deterministic so operators can fix config without
 *     surprise reordering.
 */

import { createHash } from 'node:crypto';
import type { BrainEngine } from '../core/engine.ts';

const TIER_PREFIX = 'tier:';

export interface TierLogger {
  warn: (msg: string) => void;
}

/**
 * Extract the first `tier:<name>` entry from a scopes array.
 *
 * Returns:
 *   - `undefined` when scopes is null/undefined/empty or no `tier:` entry exists.
 *   - The bare tier name (e.g. `"family"`) when a single `tier:` entry is present.
 *   - The first bare tier name when multiple `tier:` entries exist; logs a
 *     warning via the optional logger so operators can clean up their config.
 *
 * An empty tier name (e.g. the literal string `"tier:"`) is treated as absent.
 */
export function extractTierFromScopes(
  scopes: string[] | null | undefined,
  logger?: TierLogger,
): string | undefined {
  if (!scopes || scopes.length === 0) return undefined;

  const tierEntries = scopes.filter(
    (s) => typeof s === 'string' && s.startsWith(TIER_PREFIX),
  );
  if (tierEntries.length === 0) return undefined;

  if (tierEntries.length > 1 && logger) {
    logger.warn(
      `access_tokens.scopes has ${tierEntries.length} tier: entries (${tierEntries.join(', ')}); first wins`,
    );
  }

  const name = tierEntries[0].slice(TIER_PREFIX.length).trim();
  return name.length > 0 ? name : undefined;
}

/** SHA-256 hash of a bearer token, matching the format stored in access_tokens.token_hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Resolve a tier for the current MCP session/request.
 *
 * Resolution order (first non-empty wins):
 *   1. `GBRAIN_MCP_TIER` — direct override. Intended for HTTP wrappers that
 *      terminate bearer auth upstream and just want to pin a tier, and for
 *      local dev/testing without a DB.
 *   2. `GBRAIN_MCP_TOKEN` — bearer token; hashed and looked up against
 *      `access_tokens.token_hash`. The token's `scopes` are parsed for a
 *      `tier:<name>` entry.
 *   3. Otherwise `undefined` — no filtering applied (backwards-compatible
 *      behavior for all pre-Phase-2 deployments).
 *
 * Never throws — any lookup error logs and returns undefined so the server
 * stays available. Failing closed would brick existing deployments the moment
 * they upgrade.
 */
export async function resolveTierForRequest(
  engine: BrainEngine,
  logger?: TierLogger,
): Promise<string | undefined> {
  const directTier = process.env.GBRAIN_MCP_TIER;
  if (directTier && directTier.trim().length > 0) {
    return directTier.trim();
  }

  const token = process.env.GBRAIN_MCP_TOKEN;
  if (!token || token.trim().length === 0) return undefined;

  const scopes = await lookupScopesByToken(engine, token.trim(), logger);
  return extractTierFromScopes(scopes, logger);
}

/**
 * Query `access_tokens.scopes` for the given raw bearer token.
 *
 * Returns the scopes array when the token matches an active row, or undefined
 * on any of: token not found, token revoked, engine lacks SQL access (PGLite),
 * or DB error. Errors are logged but not thrown.
 */
export async function lookupScopesByToken(
  engine: BrainEngine,
  token: string,
  logger?: TierLogger,
): Promise<string[] | undefined> {
  // Only Postgres exposes .sql; PGLite schema has no access_tokens table at all.
  const sql = (engine as unknown as { sql?: unknown }).sql;
  if (!sql || typeof sql !== 'function') {
    if (logger) {
      logger.warn(
        'GBRAIN_MCP_TOKEN is set but the active engine does not support access_tokens lookups; tier unset',
      );
    }
    return undefined;
  }

  const hash = hashToken(token);
  try {
    // Tagged-template call on the `postgres` client.
    const rows = (await (sql as unknown as (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<Array<{ scopes: string[] | null }>>)`
      SELECT scopes
      FROM access_tokens
      WHERE token_hash = ${hash} AND revoked_at IS NULL
      LIMIT 1
    `);
    if (rows.length === 0) return undefined;
    const scopes = rows[0].scopes;
    return scopes ?? [];
  } catch (e: unknown) {
    if (logger) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`access_tokens lookup failed: ${msg}; tier unset`);
    }
    return undefined;
  }
}
