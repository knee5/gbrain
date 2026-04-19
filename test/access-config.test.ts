import { expect, test, describe } from "bun:test";
import { loadAccessConfig, validateAccessConfig, AccessConfig, clearAccessConfigCache } from "../src/core/access-config";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("access-config", () => {
  test("parses valid YAML with 4 tiers", () => {
    clearAccessConfigCache();
    const dir = mkdtempSync(join(tmpdir(), "gbrain-test-"));
    const path = join(dir, "access-tiers.yaml");
    writeFileSync(
      path,
      `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: ["sensitivity:owner-only"]
  none:
    description: "deny"
    allow_tags: []
    block_tags: ["*"]
`,
    );
    const cfg = loadAccessConfig(path);
    expect(cfg.version).toBe(1);
    expect(cfg.tiers.full.block_tags).toContain("sensitivity:owner-only");
    expect(cfg.tiers.none.block_tags).toContain("*");
    rmSync(dir, { recursive: true });
  });

  test("throws on missing version", () => {
    const cfg = { tiers: { full: { description: "x", allow_tags: [], block_tags: [] } } };
    expect(() => validateAccessConfig(cfg as any)).toThrow(/version/);
  });

  test("throws on missing tiers", () => {
    const cfg = { version: 1 };
    expect(() => validateAccessConfig(cfg as any)).toThrow(/tiers/);
  });

  test("throws if tier missing required fields", () => {
    const cfg = { version: 1, tiers: { full: { description: "x" } } };
    expect(() => validateAccessConfig(cfg as any)).toThrow(/allow_tags|block_tags/);
  });

  test("normalizes valid config", () => {
    const cfg = { version: 1, tiers: { full: { description: "x", allow_tags: [], block_tags: [] } } };
    const v = validateAccessConfig(cfg as any);
    expect(v.tiers.full.allow_tags).toEqual([]);
    expect(v.tiers.full.block_tags).toEqual([]);
  });

  test("loads the real repo config at config/access-tiers.yaml", () => {
    clearAccessConfigCache();
    // Resolve relative to cwd (gbrain root) — should always work when bun test runs from repo root.
    const cfg = loadAccessConfig("config/access-tiers.yaml");
    expect(cfg.version).toBe(1);
    expect(Object.keys(cfg.tiers).sort()).toEqual(["family", "full", "none", "work_jaci_bela"]);
    expect(cfg.tiers.full.block_tags).toContain("sensitivity:owner-only");
    expect(cfg.tiers.family.allow_tags).toContain("domain:family");
  });
});
