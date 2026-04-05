import type { BrainEngine } from '../core/engine.ts';

export async function runHealth(engine: BrainEngine) {
  const health = await engine.getHealth();

  const coveragePct = (health.embed_coverage * 100).toFixed(1);

  console.log('Brain Health Dashboard');
  console.log('======================');
  console.log(`Pages:              ${health.page_count}`);
  console.log(`Embed coverage:     ${coveragePct}%`);
  console.log(`Missing embeddings: ${health.missing_embeddings}`);
  console.log(`Stale pages:        ${health.stale_pages}`);
  console.log(`Orphan pages:       ${health.orphan_pages}`);
  console.log(`Dead links:         ${health.dead_links}`);

  // Health score: simple heuristic
  let score = 10;
  if (health.embed_coverage < 0.5) score -= 3;
  else if (health.embed_coverage < 0.9) score -= 1;
  if (health.stale_pages > health.page_count * 0.2) score -= 2;
  if (health.orphan_pages > health.page_count * 0.3) score -= 1;
  if (health.dead_links > 0) score -= 1;
  if (health.missing_embeddings > 0) score -= 1;
  score = Math.max(0, score);

  console.log(`\nHealth score: ${score}/10`);

  if (score < 7) {
    console.log('\nRecommendations:');
    if (health.missing_embeddings > 0) console.log('  Run: gbrain embed --stale');
    if (health.stale_pages > 0) console.log('  Review stale pages (compiled_truth older than timeline)');
    if (health.orphan_pages > 0) console.log('  Add links to orphan pages');
    if (health.dead_links > 0) console.log('  Fix dead links');
  }
}
