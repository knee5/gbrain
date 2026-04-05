import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import type { BrainEngine } from '../core/engine.ts';
import { parseMarkdown } from '../core/markdown.ts';
import { chunkText } from '../core/chunkers/recursive.ts';
import { embed, embedBatch } from '../core/embedding.ts';
import type { ChunkInput } from '../core/types.ts';

export async function runImport(engine: BrainEngine, args: string[]) {
  const dir = args.find(a => !a.startsWith('--'));
  const noEmbed = args.includes('--no-embed');

  if (!dir) {
    console.error('Usage: gbrain import <dir> [--no-embed]');
    process.exit(1);
  }

  // Collect all .md files
  const files = collectMarkdownFiles(dir);
  console.log(`Found ${files.length} markdown files`);

  let imported = 0;
  let skipped = 0;
  let chunksCreated = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const relativePath = relative(dir, filePath);

    // Progress
    if ((i + 1) % 100 === 0 || i === files.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${files.length} files processed, ${imported} imported, ${skipped} skipped`);
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseMarkdown(content, relativePath);
      const slug = parsed.slug;

      // Check content hash for idempotency
      const hash = createHash('sha256')
        .update(parsed.compiled_truth + '\n---\n' + parsed.timeline)
        .digest('hex');

      const existing = await engine.getPage(slug);
      if (existing?.content_hash === hash) {
        skipped++;
        continue;
      }

      // Upsert page
      await engine.putPage(slug, {
        type: parsed.type,
        title: parsed.title,
        compiled_truth: parsed.compiled_truth,
        timeline: parsed.timeline,
        frontmatter: parsed.frontmatter,
      });

      // Tags
      for (const tag of parsed.tags) {
        await engine.addTag(slug, tag);
      }

      // Chunk
      const chunks: ChunkInput[] = [];

      if (parsed.compiled_truth.trim()) {
        const ctChunks = chunkText(parsed.compiled_truth);
        for (const c of ctChunks) {
          chunks.push({
            chunk_index: chunks.length,
            chunk_text: c.text,
            chunk_source: 'compiled_truth',
          });
        }
      }

      if (parsed.timeline.trim()) {
        const tlChunks = chunkText(parsed.timeline);
        for (const c of tlChunks) {
          chunks.push({
            chunk_index: chunks.length,
            chunk_text: c.text,
            chunk_source: 'timeline',
          });
        }
      }

      // Embed if requested
      if (!noEmbed && chunks.length > 0) {
        try {
          const embeddings = await embedBatch(chunks.map(c => c.chunk_text));
          for (let j = 0; j < chunks.length; j++) {
            chunks[j].embedding = embeddings[j];
            chunks[j].token_count = Math.ceil(chunks[j].chunk_text.length / 4);
          }
        } catch {
          // Embedding failure is non-fatal, chunks still saved without embeddings
        }
      }

      if (chunks.length > 0) {
        await engine.upsertChunks(slug, chunks);
        chunksCreated += chunks.length;
      }

      imported++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`\n  Warning: skipped ${relativePath}: ${msg}`);
      skipped++;
    }
  }

  console.log(`\n\nImport complete:`);
  console.log(`  ${imported} pages imported`);
  console.log(`  ${skipped} pages skipped (unchanged or error)`);
  console.log(`  ${chunksCreated} chunks created`);

  // Log the ingest
  await engine.logIngest({
    source_type: 'directory',
    source_ref: dir,
    pages_updated: [],
    summary: `Imported ${imported} pages, ${skipped} skipped, ${chunksCreated} chunks`,
  });
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      // Skip hidden dirs and .raw dirs
      if (entry.startsWith('.')) continue;

      const full = join(d, entry);
      const stat = statSync(full);

      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        files.push(full);
      }
    }
  }

  walk(dir);
  return files.sort();
}
