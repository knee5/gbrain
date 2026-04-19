# Access control

## Goal

Restrict what tier-scoped callers (agents, assistants, external integrations) can
read from the brain. The owner always has full access from the local CLI; other
consumers see a filtered view of pages based on a tag-driven allow/block policy.

## What the user gets

Without this: every caller that can connect to your brain sees every page,
regardless of sensitivity. A scoped partner integration that should only see
public project notes could read through your personal journal or financial plans.

With this: you define named tiers in a YAML file and tag pages with domain /
sensitivity / scope labels. Read operations automatically filter their output
against the caller's tier. Owner access via the CLI is unaffected (no tier set
= no filtering).

## Architecture

Enforcement happens at the operations layer (`src/core/operations.ts`), after the
engine returns results but before they leave the process. Two env vars enable it:

```
GBRAIN_ACCESS_TIERS_PATH           # required — path to the base YAML config
GBRAIN_ACCESS_TIERS_OVERLAY_PATH   # optional — private overlay that extends tiers
```

When neither env var is set, the filter primitive short-circuits and every read
operation behaves exactly as it did before access control was wired in. This
makes the feature fully opt-in and backwards-compatible.

When the env var is set AND an `OperationContext.tier` is populated by the
caller, each read op runs its result through `filterByTier` /
`isVisibleToTier` before returning.

### Config shape

```yaml
version: 1
tiers:
  full:
    description: "Owner + fully-trusted partners."
    allow_tags: []
    block_tags:
      - "sensitivity:owner-only"

  family:
    description: "Family-tier visibility."
    allow_tags:
      - "domain:personal"
      - "domain:family"
      - "sensitivity:public"
    block_tags:
      - "domain:finance"
      - "domain:health"
      - "sensitivity:owner-only"

  none:
    description: "Default-deny for unlisted identities."
    allow_tags: []
    block_tags:
      - "*"
```

### Visibility rules (applied in order)

1. **Unknown tier** → deny. Safety default.
2. **`block_tags` contains `*`** → deny everything. Used by the `none` tier.
3. **Any block tag is present on the page** → deny. Blocks always win.
4. **`allow_tags` is empty** → allow (default-allow tier, e.g. `full`).
5. **At least one allow tag matches a page tag** → allow.
6. **Otherwise** → deny.

Blocks win over allows unconditionally. A tag like `sensitivity:public` in a
tier's `allow_tags` does NOT override a block from another tag on the same page.

### Overlay files

`GBRAIN_ACCESS_TIERS_OVERLAY_PATH` lets you layer a private YAML on top of the
base config. Useful when you want to ship the public shape of your tiers in a
public repo but keep specific partner/project names out.

Rules:

- The overlay can only **extend** `allow_tags` / `block_tags` of tiers that
  already exist in the base config.
- The overlay cannot introduce new tiers (doing so throws on load).
- Arrays merge with dedup — order is preserved.

## How read ops behave under enforcement

| Operation | Behavior when caller's tier cannot see the page |
|---|---|
| `get_page` | Throws `page_not_found` (indistinguishable from a truly missing page). |
| `list_pages` | Hidden pages are dropped from the result list. |
| `search` | Hidden pages are dropped from the result list. |
| `query` | Hidden pages are dropped from the hybrid-search result list. |
| `get_tags` | Returns `[]` for a hidden slug. |
| `get_timeline` | Returns `[]` for a hidden slug. |
| `get_chunks` | Returns `[]` for a hidden slug. |
| `get_links` | Drops links whose `to_slug` is hidden. |
| `get_backlinks` | Drops links whose `from_slug` is hidden. |

Writes are unaffected in this phase — the tier field only gates reads.

## Setting the tier on a caller

The CLI leaves `ctx.tier` unset, which means local owner invocations see
everything. Agent-facing entry points (an MCP server reading a tier from a
per-token scope, a web proxy reading a header, etc.) are responsible for
constructing an `OperationContext` with `tier` set to the appropriate tier
name.

See `src/core/operations.ts:OperationContext` for the full interface.

## Tagging pages

Use the existing `add_tag` op (or write tags into the page frontmatter on
ingest). Typical tag namespaces:

- `domain:<area>` — broad topic areas (`domain:personal`, `domain:finance`,
  `domain:health`, `domain:work`, etc.).
- `sensitivity:<level>` — public / owner-only markers.
- `scope:<project>` — scoped partner or project bindings, usually paired with
  an overlay that binds them to a tier.

Untagged pages only show up for tiers with empty `allow_tags` (default-allow
tiers like `full`) — that default-deny bias is intentional: it forces
migration of existing content toward explicit labels.

## What's next

- **MCP server integration** — the MCP server reads a per-token scope and
  populates `ctx.tier` automatically. Until that lands, agents that connect
  via MCP see the owner view.
- **CLI flag** — `gbrain call --tier family list_pages` for quick manual
  verification from the CLI. Not strictly necessary since owner CLI is the
  trusted path, but useful for testing tier configs.
- **Audit logging** — log every denied read at the operations layer so owners
  can see what agents tried to access that got filtered out.
