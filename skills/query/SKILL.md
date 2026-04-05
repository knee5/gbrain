# Query Skill

Answer questions using the brain's knowledge with 3-layer search and synthesis.

## Workflow

1. **Decompose the question** into search strategies:
   - Keyword search for specific names, dates, terms
   - Semantic query for conceptual questions
   - Structured queries (list by type, backlinks) for relational questions
2. **Execute searches:**
   - `gbrain search <keywords>` for FTS matches
   - `gbrain query <question>` for hybrid semantic+keyword with expansion
   - `gbrain list --type <type>` or `gbrain backlinks <slug>` for structural queries
3. **Read top results.** `gbrain get <slug>` for the top 3-5 pages to get full context.
4. **Synthesize answer** with citations. Every claim traces back to a specific page slug.
5. **Flag gaps.** If the brain doesn't have info, say "the brain doesn't have information on X" rather than hallucinating.

## Quality Rules

- Never hallucinate. Only answer from brain content.
- Cite sources: "According to concepts/do-things-that-dont-scale..."
- Flag stale results: if a search result shows [STALE], note that the info may be outdated
- For "who" questions, use backlinks and typed links to find connections
- For "what happened" questions, use timeline entries
- For "what do we know" questions, read compiled_truth directly

## Commands Used

```
gbrain search <query>
gbrain query <question>
gbrain get <slug>
gbrain list [--type T] [--tag T]
gbrain backlinks <slug>
gbrain graph <slug> [--depth N]
gbrain timeline <slug>
```
