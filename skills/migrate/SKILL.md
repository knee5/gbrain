# Migrate Skill

Universal migration from any wiki, note tool, or brain system into GBrain.

## Supported Sources

| Source | Format | Strategy |
|--------|--------|----------|
| Obsidian | Markdown + `[[wikilinks]]` | Direct import, convert wikilinks to gbrain links |
| Notion | Exported markdown or CSV | Parse Notion's export structure |
| Logseq | Markdown with `((block refs))` | Convert block refs to page links |
| Plain markdown | Any .md directory | `gbrain import <dir>` directly |
| CSV | Tabular data | Map columns to frontmatter fields |
| JSON | Structured data | Map keys to page fields |
| Roam | JSON export | Convert block structure to pages |

## General Workflow

1. **Assess the source.** What format? How many files? What structure?
2. **Plan the mapping.** How do source fields map to gbrain fields (type, title, tags, compiled_truth, timeline)?
3. **Test with a sample.** Import 5-10 files, verify with `gbrain get` and `gbrain export`.
4. **Bulk import.** Run the full migration.
5. **Verify.** `gbrain health` + `gbrain stats` + spot-check pages.
6. **Build links.** Extract cross-references from content and create typed links.

## Obsidian Migration

```bash
# 1. Direct import (obsidian vaults are markdown directories)
gbrain import /path/to/vault/

# 2. Convert [[wikilinks]] to gbrain links
# The skill reads each page's compiled_truth, finds [[Name]] patterns,
# resolves them to slugs, and creates links:
gbrain get <slug>  # read content
# For each [[Name]] found:
gbrain link <current-slug> <resolved-slug> --type references
```

Obsidian-specific:
- `[[Name]]` becomes `gbrain link`
- `[[Name|alias]]` uses the alias for context
- Tags (`#tag`) become `gbrain tag`
- Frontmatter properties map to gbrain frontmatter
- Attachments (images, PDFs) are noted but not imported (future work)

## Notion Migration

1. Export from Notion: Settings > Export > Markdown & CSV
2. Notion exports nested directories with UUIDs in filenames
3. Strip UUIDs from filenames for clean slugs
4. Map Notion's database properties to frontmatter
5. `gbrain import` the cleaned directory

## CSV Migration

For tabular data (e.g., CRM exports, contact lists):

```bash
# For each row in the CSV:
# 1. Create a page with column values as frontmatter
# 2. Use a designated column as the slug (e.g., name)
# 3. Use another column as compiled_truth (e.g., notes)
gbrain put <slug> < generated.md
```

## Verification

After any migration:
1. `gbrain stats` — check page count matches source
2. `gbrain health` — check for orphans, missing embeddings
3. `gbrain export --dir /tmp/verify/` — round-trip test
4. Spot-check 5-10 pages with `gbrain get`
5. Test search: `gbrain query "someone you know is in the data"`

## Commands Used

```
gbrain import <dir> [--no-embed]
gbrain get <slug>
gbrain put <slug>
gbrain link <from> <to> --type <type>
gbrain tag <slug> <tag>
gbrain stats
gbrain health
gbrain export [--dir ./verify/]
```
