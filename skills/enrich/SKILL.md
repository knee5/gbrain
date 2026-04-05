# Enrich Skill

Enrich person and company pages from external APIs.

## Sources

| Source | Data | API |
|--------|------|-----|
| Crustdata | LinkedIn profiles, company data | REST API |
| Happenstance | Career history, connections | REST API |
| Exa | Web mentions, articles | REST API |

Note: enrichment requires separate API credentials for each service. No client
integrations ship in v1. This skill guides Claude Code to make API calls directly.

## Workflow

1. **Select target pages.** `gbrain list --type person` or `gbrain list --type company`
2. **For each page:**
   - Read current compiled_truth to understand what we already know
   - Call external APIs for fresh data
   - Store raw API responses: the raw JSON goes into `gbrain call put_raw_data`
   - Distill highlights into compiled_truth updates
3. **Validation rules:**
   - Connection count < 20 on LinkedIn = likely wrong person, skip
   - Name mismatch between brain and API = skip, flag for manual review
   - Don't overwrite human-written assessments with API boilerplate

## Quality Rules

- Raw data goes to raw_data table (preserves provenance)
- Only distilled, useful info goes to compiled_truth
- Always add a timeline entry: "Enriched from [source] on [date]"
- Don't enrich the same page more than once per week unless requested
- Rate limit: respect API rate limits, use exponential backoff

## Commands Used

```
gbrain get <slug>
gbrain put <slug>
gbrain timeline-add <slug> <date> "Enriched from <source>"
gbrain list --type person
gbrain list --type company
```
