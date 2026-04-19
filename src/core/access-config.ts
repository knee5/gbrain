import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface TierRules {
  description: string;
  allow_tags: string[];
  block_tags: string[];
}

export interface AccessConfig {
  version: number;
  tiers: Record<string, TierRules>;
}

export function validateAccessConfig(raw: unknown): AccessConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("access-config: expected object, got " + typeof raw);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number") {
    throw new Error("access-config: missing or non-numeric 'version'");
  }
  if (!obj.tiers || typeof obj.tiers !== "object") {
    throw new Error("access-config: missing 'tiers' object");
  }
  const tiers = obj.tiers as Record<string, unknown>;
  const validated: Record<string, TierRules> = {};
  for (const [name, rawTier] of Object.entries(tiers)) {
    if (!rawTier || typeof rawTier !== "object") {
      throw new Error(`access-config: tier '${name}' is not an object`);
    }
    const t = rawTier as Record<string, unknown>;
    if (typeof t.description !== "string") {
      throw new Error(`access-config: tier '${name}' missing 'description' string`);
    }
    if (!Array.isArray(t.allow_tags)) {
      throw new Error(`access-config: tier '${name}' missing 'allow_tags' array`);
    }
    if (!Array.isArray(t.block_tags)) {
      throw new Error(`access-config: tier '${name}' missing 'block_tags' array`);
    }
    validated[name] = {
      description: t.description,
      allow_tags: t.allow_tags.filter((x): x is string => typeof x === "string"),
      block_tags: t.block_tags.filter((x): x is string => typeof x === "string"),
    };
  }
  return { version: obj.version, tiers: validated };
}

/**
 * Shape of an overlay file. Tiers referenced in the overlay MUST already exist
 * in the base config — overlays can only extend allow_tags/block_tags of
 * existing tiers, never define new ones. description is optional (ignored).
 */
interface OverlayConfig {
  tiers?: Record<
    string,
    {
      description?: unknown;
      allow_tags?: unknown;
      block_tags?: unknown;
    }
  >;
}

function dedupedConcat(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const out = [...base];
  for (const x of extra) {
    if (typeof x !== "string") continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function mergeOverlay(base: AccessConfig, overlayPath: string): AccessConfig {
  const raw = parseYaml(readFileSync(overlayPath, "utf-8")) as OverlayConfig | null;
  if (!raw || typeof raw !== "object") return base;
  if (!raw.tiers || typeof raw.tiers !== "object") return base;

  // Deep-copy base.tiers so we don't mutate the original.
  const mergedTiers: Record<string, TierRules> = {};
  for (const [name, rules] of Object.entries(base.tiers)) {
    mergedTiers[name] = {
      description: rules.description,
      allow_tags: [...rules.allow_tags],
      block_tags: [...rules.block_tags],
    };
  }

  for (const [tierName, overlayTier] of Object.entries(raw.tiers)) {
    if (!mergedTiers[tierName]) {
      throw new Error(
        `access-config overlay: tier '${tierName}' not defined in base config (overlays can only extend existing tiers)`,
      );
    }
    const overlayAllow = Array.isArray(overlayTier.allow_tags) ? overlayTier.allow_tags : [];
    const overlayBlock = Array.isArray(overlayTier.block_tags) ? overlayTier.block_tags : [];
    mergedTiers[tierName] = {
      description: mergedTiers[tierName].description,
      allow_tags: dedupedConcat(mergedTiers[tierName].allow_tags, overlayAllow as string[]),
      block_tags: dedupedConcat(mergedTiers[tierName].block_tags, overlayBlock as string[]),
    };
  }

  return { version: base.version, tiers: mergedTiers };
}

let cached: AccessConfig | null = null;
let cachedKey: string | null = null;

function cacheKey(basePath: string, overlayPath?: string): string {
  return overlayPath ? `${basePath}||${overlayPath}` : basePath;
}

/**
 * Load the public base YAML, optionally merging a private overlay on top.
 *
 * - If `overlayPath` is omitted, behaves exactly as before (base only).
 * - If `overlayPath` is provided but the file does not exist, returns base
 *   (no error — overlay is optional in deployments that don't need it).
 * - If `overlayPath` is provided and the file exists, merges additively:
 *   allow_tags and block_tags from the overlay are appended (deduped) to the
 *   corresponding base tier. Overlays MAY NOT introduce new tiers; doing so
 *   throws.
 *
 * Cache key includes overlayPath so different overlays don't collide in cache.
 */
export function loadAccessConfig(basePath: string, overlayPath?: string): AccessConfig {
  const key = cacheKey(basePath, overlayPath);
  if (cached && cachedKey === key) return cached;

  const raw = parseYaml(readFileSync(basePath, "utf-8"));
  let cfg = validateAccessConfig(raw);

  if (overlayPath && existsSync(overlayPath)) {
    cfg = mergeOverlay(cfg, overlayPath);
  }

  cached = cfg;
  cachedKey = key;
  return cfg;
}

export function clearAccessConfigCache(): void {
  cached = null;
  cachedKey = null;
}
