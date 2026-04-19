import { readFileSync } from "node:fs";
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

let cached: AccessConfig | null = null;
let cachedPath: string | null = null;

export function loadAccessConfig(path: string): AccessConfig {
  if (cached && cachedPath === path) return cached;
  const raw = parseYaml(readFileSync(path, "utf-8"));
  const cfg = validateAccessConfig(raw);
  cached = cfg;
  cachedPath = path;
  return cfg;
}

export function clearAccessConfigCache(): void {
  cached = null;
  cachedPath = null;
}
