import { readFileSync } from 'fs';
import type { BrainEngine } from '../core/engine.ts';
import { parseMarkdown } from '../core/markdown.ts';

export async function runPut(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain put <slug> [< file.md]');
    process.exit(1);
  }

  // Read from stdin or file arg
  let content: string;
  const fileArg = args[1];
  if (fileArg) {
    content = readFileSync(fileArg, 'utf-8');
  } else if (!process.stdin.isTTY) {
    content = readFileSync('/dev/stdin', 'utf-8');
  } else {
    console.error('Provide content via stdin or file argument');
    console.error('  gbrain put people/john < john.md');
    console.error('  cat john.md | gbrain put people/john');
    process.exit(1);
  }

  const parsed = parseMarkdown(content, slug + '.md');

  // Create version snapshot before updating
  const existing = await engine.getPage(slug);
  if (existing) {
    await engine.createVersion(slug);
  }

  const page = await engine.putPage(slug, {
    type: parsed.type,
    title: parsed.title,
    compiled_truth: parsed.compiled_truth,
    timeline: parsed.timeline,
    frontmatter: parsed.frontmatter,
  });

  // Update tags
  if (parsed.tags.length > 0) {
    for (const tag of parsed.tags) {
      await engine.addTag(slug, tag);
    }
  }

  console.log(`${existing ? 'Updated' : 'Created'}: ${page.slug} (${page.type})`);
}
