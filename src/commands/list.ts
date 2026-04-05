import type { BrainEngine } from '../core/engine.ts';
import type { PageType } from '../core/types.ts';

export async function runList(engine: BrainEngine, args: string[]) {
  const typeIdx = args.indexOf('--type');
  const tagIdx = args.indexOf('--tag');
  const limitIdx = args.indexOf('-n');

  const type = typeIdx !== -1 ? (args[typeIdx + 1] as PageType) : undefined;
  const tag = tagIdx !== -1 ? args[tagIdx + 1] : undefined;
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 50;

  const pages = await engine.listPages({ type, tag, limit });

  if (pages.length === 0) {
    console.log('No pages found.');
    return;
  }

  for (const p of pages) {
    const date = p.updated_at.toISOString().split('T')[0];
    console.log(`${p.slug}\t${p.type}\t${date}\t${p.title}`);
  }
  console.log(`\n${pages.length} pages`);
}
