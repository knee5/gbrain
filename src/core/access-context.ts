import { existsSync } from 'node:fs';
import type { AccessConfig } from './access-config.ts';
import { loadAccessConfig } from './access-config.ts';

let cachedConfig: AccessConfig | null = null;
let resolved = false;

/**
 * Resolve + cache the access config from env vars. Returns null if no config
 * is configured (either the path env is unset or the file doesn't exist).
 *
 * Env vars:
 *   GBRAIN_ACCESS_TIERS_PATH          — required to enable enforcement
 *   GBRAIN_ACCESS_TIERS_OVERLAY_PATH  — optional private overlay
 */
export function getAccessConfig(): AccessConfig | null {
  if (resolved) return cachedConfig;
  resolved = true;

  const basePath = process.env.GBRAIN_ACCESS_TIERS_PATH;
  if (!basePath || !existsSync(basePath)) {
    cachedConfig = null;
    return null;
  }

  const overlayPath = process.env.GBRAIN_ACCESS_TIERS_OVERLAY_PATH;
  cachedConfig = loadAccessConfig(basePath, overlayPath);
  return cachedConfig;
}

/**
 * Convenience: should this request be filtered? True only when BOTH a tier
 * is set on the context AND a config file is configured + loadable.
 */
export function shouldEnforce(tier: string | undefined): boolean {
  if (!tier) return false;
  return getAccessConfig() !== null;
}

/** Test hook — clears singleton cache. */
export function clearAccessContextCache(): void {
  cachedConfig = null;
  resolved = false;
}
