import type { BrainEngine } from '../core/engine.ts';

export async function runTags(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain tags <slug>');
    process.exit(1);
  }

  const tags = await engine.getTags(slug);
  if (tags.length === 0) {
    console.log(`No tags for ${slug}`);
  } else {
    console.log(tags.join(', '));
  }
}

export async function runTag(engine: BrainEngine, args: string[]) {
  const [slug, tag] = args;
  if (!slug || !tag) {
    console.error('Usage: gbrain tag <slug> <tag>');
    process.exit(1);
  }
  await engine.addTag(slug, tag);
  console.log(`Tagged ${slug} with "${tag}"`);
}

export async function runUntag(engine: BrainEngine, args: string[]) {
  const [slug, tag] = args;
  if (!slug || !tag) {
    console.error('Usage: gbrain untag <slug> <tag>');
    process.exit(1);
  }
  await engine.removeTag(slug, tag);
  console.log(`Removed tag "${tag}" from ${slug}`);
}
