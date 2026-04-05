import type { BrainEngine } from '../core/engine.ts';

export async function runStats(engine: BrainEngine) {
  const stats = await engine.getStats();

  console.log('Brain Statistics');
  console.log('================');
  console.log(`Pages:            ${stats.page_count}`);
  console.log(`Chunks:           ${stats.chunk_count}`);
  console.log(`Embedded:         ${stats.embedded_count}`);
  console.log(`Links:            ${stats.link_count}`);
  console.log(`Tags:             ${stats.tag_count}`);
  console.log(`Timeline entries: ${stats.timeline_entry_count}`);

  if (Object.keys(stats.pages_by_type).length > 0) {
    console.log('\nPages by type:');
    for (const [type, count] of Object.entries(stats.pages_by_type)) {
      console.log(`  ${type}: ${count}`);
    }
  }
}
