import type { BrainEngine } from '../core/engine.ts';

export async function runSearch(engine: BrainEngine, args: string[]) {
  const query = args.join(' ');
  if (!query) {
    console.error('Usage: gbrain search <query>');
    process.exit(1);
  }

  const results = await engine.searchKeyword(query, { limit: 20 });

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  for (const r of results) {
    const staleTag = r.stale ? ' [STALE]' : '';
    console.log(`${r.slug} (${r.type}) score=${r.score.toFixed(3)}${staleTag}`);
    console.log(`  ${r.chunk_text.slice(0, 120)}...`);
    console.log();
  }
  console.log(`${results.length} results`);
}
