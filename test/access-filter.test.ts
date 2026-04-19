import { expect, test, describe } from "bun:test";
import { filterByTier, isVisibleToTier, PageForFilter } from "../src/core/access-filter";
import { AccessConfig } from "../src/core/access-config";

const cfg: AccessConfig = {
  version: 1,
  tiers: {
    full: {
      description: "owner",
      allow_tags: [],
      block_tags: ["sensitivity:owner-only"],
    },
    family: {
      description: "family",
      allow_tags: ["domain:family", "domain:personal", "scope:dads-house-sale", "sensitivity:public"],
      block_tags: [
        "domain:finance", "domain:health", "domain:identity", "domain:work",
        "scope:x-energy", "scope:jaci-bela", "scope:landscaping-saas", "scope:idearanker",
        "sensitivity:owner-only",
      ],
    },
    work_scoped: {
      description: "jaci-scoped",
      allow_tags: ["scope:jaci-bela", "sensitivity:public"],
      block_tags: ["sensitivity:owner-only"],
    },
    none: {
      description: "deny",
      allow_tags: [],
      block_tags: ["*"],
    },
  },
};

const p = (slug: string, tags: string[]): PageForFilter => ({ slug, tags });

describe("isVisibleToTier — full tier", () => {
  test("full sees untagged pages (default allow when allow_tags empty)", () => {
    expect(isVisibleToTier(p("a", []), "full", cfg)).toBe(true);
  });
  test("full sees domain:finance", () => {
    expect(isVisibleToTier(p("a", ["domain:finance"]), "full", cfg)).toBe(true);
  });
  test("full blocked from sensitivity:owner-only", () => {
    expect(isVisibleToTier(p("a", ["domain:personal", "sensitivity:owner-only"]), "full", cfg)).toBe(false);
  });
});

describe("isVisibleToTier — family tier", () => {
  test("family sees domain:family pages", () => {
    expect(isVisibleToTier(p("a", ["domain:family"]), "family", cfg)).toBe(true);
  });
  test("family sees domain:personal pages", () => {
    expect(isVisibleToTier(p("a", ["domain:personal"]), "family", cfg)).toBe(true);
  });
  test("family sees scope:dads-house-sale", () => {
    expect(isVisibleToTier(p("a", ["scope:dads-house-sale"]), "family", cfg)).toBe(true);
  });
  test("family blocked from domain:finance even if also family", () => {
    expect(isVisibleToTier(p("a", ["domain:family", "domain:finance"]), "family", cfg)).toBe(false);
  });
  test("family blocked from scope:jaci-bela", () => {
    expect(isVisibleToTier(p("a", ["scope:jaci-bela"]), "family", cfg)).toBe(false);
  });
  test("family blocked from untagged pages (no allow tag match)", () => {
    expect(isVisibleToTier(p("a", []), "family", cfg)).toBe(false);
  });
  test("sensitivity:public does NOT override explicit blocks (blocks win)", () => {
    expect(isVisibleToTier(p("a", ["domain:finance", "sensitivity:public"]), "family", cfg)).toBe(false);
  });
  test("sensitivity:public alone (no blocks) is visible to family", () => {
    expect(isVisibleToTier(p("a", ["sensitivity:public"]), "family", cfg)).toBe(true);
  });
});

describe("isVisibleToTier — work_scoped tier", () => {
  test("sees scope:jaci-bela pages", () => {
    expect(isVisibleToTier(p("a", ["scope:jaci-bela"]), "work_scoped", cfg)).toBe(true);
  });
  test("blocked from non-jaci content", () => {
    expect(isVisibleToTier(p("a", ["domain:finance"]), "work_scoped", cfg)).toBe(false);
  });
  test("blocked from untagged", () => {
    expect(isVisibleToTier(p("a", []), "work_scoped", cfg)).toBe(false);
  });
});

describe("isVisibleToTier — none tier", () => {
  test("none sees nothing (wildcard block)", () => {
    expect(isVisibleToTier(p("a", ["domain:family"]), "none", cfg)).toBe(false);
    expect(isVisibleToTier(p("a", ["sensitivity:public"]), "none", cfg)).toBe(false);
    expect(isVisibleToTier(p("a", []), "none", cfg)).toBe(false);
  });
});

describe("isVisibleToTier — unknown tier", () => {
  test("unknown tier defaults to deny-all", () => {
    expect(isVisibleToTier(p("a", ["domain:personal"]), "nonexistent-tier", cfg)).toBe(false);
  });
});

describe("filterByTier", () => {
  test("filters a list of pages", () => {
    const pages = [
      p("family-event", ["domain:family"]),
      p("portfolio", ["domain:finance"]),
      p("personal-log", ["domain:personal"]),
      p("jaci-deck", ["scope:jaci-bela"]),
    ];
    const visible = filterByTier(pages, "family", cfg);
    expect(visible.map((x) => x.slug)).toEqual(["family-event", "personal-log"]);
  });
  test("preserves type T on generics", () => {
    const pages: Array<PageForFilter & { extra: string }> = [
      { slug: "a", tags: ["domain:personal"], extra: "meta" },
      { slug: "b", tags: ["domain:finance"], extra: "data" },
    ];
    const visible = filterByTier(pages, "family", cfg);
    expect(visible).toHaveLength(1);
    expect(visible[0].extra).toBe("meta");
  });
  test("empty input returns empty", () => {
    expect(filterByTier([], "family", cfg)).toEqual([]);
  });
});
