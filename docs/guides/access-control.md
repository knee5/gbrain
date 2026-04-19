# Access Control Primitive

## Goal

Let a gbrain deployment define tier-based content visibility using the existing
tag system. Useful when one brain serves multiple readers with different levels
of access (owner + family members, owner + partners, multi-tenant), or when you
want a deny-all fallback during staging.

## What the User Gets

Without this: every reader sees everything the MCP or CLI returns. The only
scoping primitive is `OperationContext.remote`, which is binary — trusted vs
untrusted.

With this: a two-dimensional visibility model. Tags say what content *is*;
tiers say what each reader can *see*. Pages get normal tags during ingest. A
tier config says "the `family` tier can see `domain:family` but not
`domain:finance`." The filter takes a page list + a tier name + the config,
returns only the pages visible to that tier.

This PR adds the filter primitive. It does NOT wire the filter into any
existing read path — that's opt-in, and intended as a follow-up PR.

## Usage

### Step 1 — Ship the config

Copy the example:

```
cp config/access-tiers.example.yaml config/access-tiers.yaml
```

Edit the tiers to match your deployment. See the header comment in the file
for the semantic rules (block-wins, default-allow when allow_tags is empty,
etc.).

### Step 2 — Load the config once at startup

```typescript
import { loadAccessConfig } from "./core/access-config";

const accessConfig = loadAccessConfig("config/access-tiers.yaml");
```

Results are cached by path. Subsequent calls are free.

### Step 3 — Apply the filter wherever you fan out page results

```typescript
import { filterByTier } from "./core/access-filter";

const pages = await engine.listPages({ limit: 100 });
const visible = filterByTier(pages, ctx.tier ?? "full", accessConfig);
return visible;
```

The filter is pure and generic — it returns the same shape you pass in. Works
on search results, `list_pages`, `find_orphans`, or any object that implements
`{slug: string, tags: string[]}`.

### Step 4 (optional) — Overlay for site-specific bindings

Multi-tenant deployments or those with owner-sensitive scope names can keep
concrete bindings in a separate YAML that isn't committed to the shared
config:

```yaml
# config/access-tiers.overrides.yaml (gitignored)
tiers:
  scoped:
    allow_tags:
      - scope:confidential-project-a
```

Load with two paths:

```typescript
const accessConfig = loadAccessConfig(
  "config/access-tiers.yaml",
  process.env.ACCESS_TIERS_OVERLAY_PATH, // or pass a literal path
);
```

Overlays can only *extend* existing tiers (append to `allow_tags` /
`block_tags`, deduped). They cannot introduce new tiers — the base file is the
authoritative shape. A missing overlay file is not an error; the loader
returns the base config unchanged.

## Rules

Applied in order by `isVisibleToTier(page, tierName, config)`:

1. Unknown tier → **deny** (safety default).
2. `block_tags` wildcard `"*"` → **deny everything** (used by `none` tier).
3. Any specific `block_tag` present on page → **deny** (blocks always win).
4. Empty `allow_tags` → **allow** (default-allow; e.g. `full` tier).
5. Any `allow_tag` present on page → **allow**.
6. Otherwise → **deny** (page has no matching allow tag).

## When NOT to use this

- **Secrets.** Tier filtering is a *visibility* primitive, not a
  *confidentiality* one. A determined attacker with direct DB access bypasses
  it. For real confidentiality, pair with Postgres RLS at the engine layer.
- **Single-reader brains.** If only the owner reads the brain, you don't need
  tiers. The default-allow path covers you and the overhead is unnecessary.

## What's next

A follow-up PR can add a small adapter in `operations.ts` so that read paths
(`search`, `list_pages`, `find_orphans`, etc.) take an optional `tier` from
`OperationContext` and apply `filterByTier` before returning. That's where the
primitive becomes enforcing — this PR just lands the library.
