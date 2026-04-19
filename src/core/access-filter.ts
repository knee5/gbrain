import { AccessConfig } from "./access-config";

export interface PageForFilter {
  slug: string;
  tags: string[];
}

/**
 * Determines whether a page is visible to the given tier per the config rules.
 *
 * Rules (applied in order):
 *   1. Unknown tier → deny (safety default).
 *   2. block_tags wildcard "*" → deny everything (used by 'none' tier).
 *   3. Any specific block_tag present on page → deny (blocks always win).
 *   4. If allow_tags is empty → allow (default-allow tiers like 'full').
 *   5. If any allow_tag matches a page tag → allow.
 *   6. Otherwise → deny (page has no matching allow tag; default-deny).
 */
export function isVisibleToTier(
  page: PageForFilter,
  tierName: string,
  config: AccessConfig,
): boolean {
  const tier = config.tiers[tierName];
  if (!tier) return false; // unknown tier = deny

  const pageTagSet = new Set(page.tags);

  // Rule 2: block-everything wildcard
  if (tier.block_tags.includes("*")) return false;

  // Rule 3: any specific block tag present
  for (const blockTag of tier.block_tags) {
    if (pageTagSet.has(blockTag)) return false;
  }

  // Rule 4: default-allow tier (empty allow_tags)
  if (tier.allow_tags.length === 0) return true;

  // Rule 5: any allow tag match
  for (const allowTag of tier.allow_tags) {
    if (pageTagSet.has(allowTag)) return true;
  }

  // Rule 6: no allow match
  return false;
}

/**
 * Filters a list of pages to only those visible to the given tier.
 *
 * Pure function. No I/O. Safe to call on large arrays (O(n*m) where m = block+allow
 * tag counts per tier, typically <20).
 *
 * Generic over T so callers can pass rich page objects and get them back intact.
 */
export function filterByTier<T extends PageForFilter>(
  pages: T[],
  tierName: string,
  config: AccessConfig,
): T[] {
  return pages.filter((page) => isVisibleToTier(page, tierName, config));
}
