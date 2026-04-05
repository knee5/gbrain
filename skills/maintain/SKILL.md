# Maintain Skill

Periodic brain health checks and cleanup.

## Workflow

1. **Run health check.** `gbrain health` to get the dashboard.
2. **Check each dimension:**

### Stale pages
Pages where compiled_truth is older than the latest timeline entry. The assessment hasn't been updated to reflect recent evidence.
- `gbrain query "stale pages"` or check health output
- For each stale page: read timeline, determine if compiled_truth needs rewriting

### Orphan pages
Pages with zero inbound links. Nobody references them.
- Review orphans: are they genuinely isolated or just missing links?
- Add links from related pages or flag for deletion

### Dead links
Links pointing to pages that don't exist.
- Remove dead links with `gbrain unlink`

### Missing cross-references
Pages that mention entity names but don't have formal links.
- Read compiled_truth, extract entity mentions, create links

### Tag consistency
Inconsistent tagging (e.g., "vc" vs "venture-capital", "ai" vs "artificial-intelligence").
- Standardize to the most common variant

### Embedding freshness
Chunks without embeddings, or chunks embedded with an old model.
- `gbrain embed --stale` to backfill

### Open threads
Timeline items older than 30 days with unresolved action items.
- Flag for review

## Quality Rules

- Never delete pages without confirmation
- Log all changes via timeline entries
- Run `gbrain health` before and after to show improvement

## Commands Used

```
gbrain health
gbrain list [--type T]
gbrain get <slug>
gbrain backlinks <slug>
gbrain link <from> <to> --type <type>
gbrain unlink <from> <to>
gbrain tag <slug> <tag>
gbrain untag <slug> <tag>
gbrain embed --stale
gbrain timeline <slug>
```
