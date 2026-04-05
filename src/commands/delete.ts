import type { BrainEngine } from '../core/engine.ts';

export async function runDelete(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain delete <slug>');
    process.exit(1);
  }

  const page = await engine.getPage(slug);
  if (!page) {
    console.error(`Page not found: ${slug}`);
    process.exit(1);
  }

  await engine.deletePage(slug);
  console.log(`Deleted: ${slug}`);
}
