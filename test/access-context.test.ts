import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getAccessConfig,
  clearAccessContextCache,
  shouldEnforce,
} from '../src/core/access-context';

describe('access-context', () => {
  beforeEach(() => {
    clearAccessContextCache();
    delete process.env.GBRAIN_ACCESS_TIERS_PATH;
    delete process.env.GBRAIN_ACCESS_TIERS_OVERLAY_PATH;
  });

  it('returns null when config file path is not set', () => {
    expect(getAccessConfig()).toBeNull();
  });

  it('returns null when config file does not exist at path', () => {
    process.env.GBRAIN_ACCESS_TIERS_PATH = '/nonexistent/path.yaml';
    expect(getAccessConfig()).toBeNull();
  });

  it('returns a loaded config when path is valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-access-ctx-'));
    const path = join(dir, 'access-tiers.yaml');
    writeFileSync(
      path,
      `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: []
  none:
    description: "deny-all"
    allow_tags: []
    block_tags: ["*"]
`,
    );
    process.env.GBRAIN_ACCESS_TIERS_PATH = path;
    const cfg = getAccessConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.version).toBe(1);
    expect(cfg!.tiers.none.block_tags).toContain('*');
    rmSync(dir, { recursive: true });
  });

  it('shouldEnforce is false when tier is unset', () => {
    expect(shouldEnforce(undefined)).toBe(false);
  });

  it('shouldEnforce is false when config is null', () => {
    expect(shouldEnforce('family')).toBe(false);
  });

  it('shouldEnforce is true when both tier and config are set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-access-ctx-'));
    const path = join(dir, 'access-tiers.yaml');
    writeFileSync(
      path,
      `version: 1
tiers:
  family:
    description: "family"
    allow_tags: ["domain:personal"]
    block_tags: []
`,
    );
    process.env.GBRAIN_ACCESS_TIERS_PATH = path;
    expect(shouldEnforce('family')).toBe(true);
    rmSync(dir, { recursive: true });
  });

  it('caches the config across calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-access-ctx-'));
    const path = join(dir, 'access-tiers.yaml');
    writeFileSync(
      path,
      `version: 1
tiers:
  full:
    description: "owner"
    allow_tags: []
    block_tags: []
`,
    );
    process.env.GBRAIN_ACCESS_TIERS_PATH = path;
    const cfg1 = getAccessConfig();
    const cfg2 = getAccessConfig();
    expect(cfg1).toBe(cfg2); // same reference → cached
    rmSync(dir, { recursive: true });
  });
});
