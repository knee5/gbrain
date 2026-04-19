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
    expect(Object.keys(cfg.tiers).sort()).toEqual(["family", "full", "none", "work_scoped"]);
    expect(cfg.tiers.full.block_tags).toContain("sensitivity:owner-only");
    expect(cfg.tiers.family.allow_tags).toContain("domain:family");
    // Public base must NOT leak product-specific scope names.
    expect(cfg.tiers.work_scoped.allow_tags).not.toContain("scope:jaci-bela");
  });
});

describe("access-config overlay merging", () => {
  test("overlay adds allow_tags to existing tier (deduped, additive)", () => {
    clearAccessConfigCache();
    const dir = mkdtempSync(join(tmpdir(), "gbrain-overlay-"));
    const basePath = join(dir, "access-tiers.yaml");
    const overlayPath = join(dir, "access-tiers.overrides.yaml");
    writeFileSync(
      basePath,
      `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: ["sensitivity:owner-only"]
  work_scoped:
    description: "scoped work"
    allow_tags: ["sensitivity:public"]
    block_tags: ["sensitivity:owner-only"]
`,
    );
    writeFileSync(
      overlayPath,
      `tiers:
  work_scoped:
    allow_tags:
      - "scope:jaci-bela"
      - "sensitivity:public"  # duplicate — should be deduped
    block_tags:
      - "domain:finance"
`,
    );
    const cfg = loadAccessConfig(basePath, overlayPath);
    expect(cfg.tiers.work_scoped.allow_tags).toContain("scope:jaci-bela");
    expect(cfg.tiers.work_scoped.allow_tags).toContain("sensitivity:public");
    // Dedup check: sensitivity:public should appear only once.
    expect(
      cfg.tiers.work_scoped.allow_tags.filter((t) => t === "sensitivity:public").length,
    ).toBe(1);
    expect(cfg.tiers.work_scoped.block_tags).toContain("domain:finance");
    expect(cfg.tiers.work_scoped.block_tags).toContain("sensitivity:owner-only");
    // Other tiers untouched.
    expect(cfg.tiers.full.allow_tags).toEqual([]);
    rmSync(dir, { recursive: true });
  });

  test("overlay referencing a tier not in base throws", () => {
    clearAccessConfigCache();
    const dir = mkdtempSync(join(tmpdir(), "gbrain-overlay-"));
    const basePath = join(dir, "access-tiers.yaml");
    const overlayPath = join(dir, "access-tiers.overrides.yaml");
    writeFileSync(
      basePath,
      `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: ["sensitivity:owner-only"]
`,
    );
    writeFileSync(
      overlayPath,
      `tiers:
  tier_that_does_not_exist:
    allow_tags: ["scope:whatever"]
`,
    );
    expect(() => loadAccessConfig(basePath, overlayPath)).toThrow(/not defined in base/);
    rmSync(dir, { recursive: true });
  });

  test("overlay path provided but file missing → no error, returns base", () => {
    clearAccessConfigCache();
    const dir = mkdtempSync(join(tmpdir(), "gbrain-overlay-"));
    const basePath = join(dir, "access-tiers.yaml");
    const overlayPath = join(dir, "does-not-exist.yaml");
    writeFileSync(
      basePath,
      `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: ["sensitivity:owner-only"]
  work_scoped:
    description: "scoped"
    allow_tags: ["sensitivity:public"]
    block_tags: ["sensitivity:owner-only"]
`,
    );
    const cfg = loadAccessConfig(basePath, overlayPath);
    expect(cfg.tiers.work_scoped.allow_tags).toEqual(["sensitivity:public"]);
    rmSync(dir, { recursive: true });
  });

  test("no overlay path → base returned unchanged", () => {
    clearAccessConfigCache();
    const dir = mkdtempSync(join(tmpdir(), "gbrain-overlay-"));
    const basePath = join(dir, "access-tiers.yaml");
    writeFileSync(
      basePath,
      `version: 1
tiers:
  work_scoped:
    description: "scoped"
    allow_tags: ["sensitivity:public"]
    block_tags: ["sensitivity:owner-only"]
`,
    );
    const cfg = loadAccessConfig(basePath);
    expect(cfg.tiers.work_scoped.allow_tags).toEqual(["sensitivity:public"]);
    expect(cfg.tiers.work_scoped.block_tags).toEqual(["sensitivity:owner-only"]);
    rmSync(dir, { recursive: true });
  });
});
