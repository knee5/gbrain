import type { BrainEngine } from '../core/engine.ts';
import { serializeMarkdown } from '../core/markdown.ts';

export async function runGet(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain get <slug>');
    process.exit(1);
  }

  // Try exact match first, then fuzzy resolve
  let page = await engine.getPage(slug);
  if (!page) {
    const candidates = await engine.resolveSlugs(slug);
    if (candidates.length === 1) {
      page = await engine.getPage(candidates[0]);
    } else if (candidates.length > 1) {
      console.error(`Ambiguous slug "${slug}". Did you mean:`);
      for (const c of candidates) console.error(`  ${c}`);
      process.exit(1);
    }
  }

  if (!page) {
    console.error(`Page not found: ${slug}`);
    process.exit(1);
  }

  const tags = await engine.getTags(page.slug);
  const md = serializeMarkdown(
    page.frontmatter,
    page.compiled_truth,
    page.timeline,
    { type: page.type, title: page.title, tags },
  );
  process.stdout.write(md);
}
