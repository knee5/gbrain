import type { BrainEngine } from '../core/engine.ts';

export async function runTimeline(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain timeline <slug>');
    process.exit(1);
  }

  const entries = await engine.getTimeline(slug);
  if (entries.length === 0) {
    console.log(`No timeline entries for ${slug}`);
    return;
  }

  for (const e of entries) {
    const source = e.source ? ` [${e.source}]` : '';
    console.log(`${e.date}${source}: ${e.summary}`);
    if (e.detail) {
      console.log(`  ${e.detail.slice(0, 200)}`);
    }
  }
}

export async function runTimelineAdd(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  const date = args[1];
  const text = args.slice(2).join(' ');

  if (!slug || !date || !text) {
    console.error('Usage: gbrain timeline-add <slug> <date> <text>');
    process.exit(1);
  }

  await engine.addTimelineEntry(slug, {
    date,
    summary: text,
  });
  console.log(`Added timeline entry to ${slug}`);
}
