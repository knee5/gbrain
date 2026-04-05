# Ingest Skill

Ingest meetings, articles, documents, and conversations into the brain.

## Workflow

1. **Parse the source.** Extract people, companies, dates, and events from the input.
2. **For each entity mentioned:**
   - `gbrain get <slug>` to check if page exists
   - If exists: update compiled_truth (rewrite State section with new info, don't append)
   - If new: `gbrain put <slug>` to create the page
3. **Append to timeline.** `gbrain timeline-add <slug> <date> <summary>` for each event.
4. **Create cross-reference links.** `gbrain link <from> <to> --type <relationship>` for every entity pair mentioned together.
5. **Timeline merge.** The same event appears on ALL mentioned entities' timelines. If Alice met Bob at Acme Corp, the event goes on Alice's page, Bob's page, and Acme Corp's page.

## Quality Rules

- Executive summary in compiled_truth must be updated, not just timeline appended
- State section is REWRITTEN, not appended to. Current best understanding only.
- Timeline entries are reverse-chronological (newest first)
- Every person/company mentioned gets a page if one doesn't exist
- Link types: knows, works_at, invested_in, founded, met_at, discussed
- Source attribution: every timeline entry includes the source (meeting, article, email, etc.)

## Commands Used

```
gbrain get <slug>
gbrain put <slug> < content.md
gbrain timeline-add <slug> <date> <summary>
gbrain link <from> <to> --type <type>
gbrain tags <slug>
gbrain tag <slug> <tag>
```
