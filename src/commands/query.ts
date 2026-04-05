import type { BrainEngine } from '../core/engine.ts';
import { hybridSearch } from '../core/search/hybrid.ts';
import { expandQuery } from '../core/search/expansion.ts';

export async function runQuery(engine: BrainEngine, args: string[]) {
  const query = args.filter(a => !a.startsWith('--')).join(' ');
  const noExpand = args.includes('--no-expand');

  if (!query) {
    console.error('Usage: gbrain query <question>');
    process.exit(1);
  }

  const results = await hybridSearch(engine, query, {
    limit: 20,
    expansion: !noExpand,
    expandFn: expandQuery,
  });

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  for (const r of results) {
    const staleTag = r.stale ? ' [STALE]' : '';
    console.log(`${r.slug} (${r.type}) score=${r.score.toFixed(4)}${staleTag}`);
    console.log(`  ${r.chunk_text.slice(0, 120)}...`);
    console.log();
  }
  console.log(`${results.length} results`);
}
