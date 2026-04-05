import type { BrainEngine } from '../core/engine.ts';

export async function runHistory(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain history <slug>');
    process.exit(1);
  }

  const versions = await engine.getVersions(slug);
  if (versions.length === 0) {
    console.log(`No version history for ${slug}`);
    return;
  }

  console.log(`Version history for ${slug}:`);
  for (const v of versions) {
    const date = new Date(v.snapshot_at).toISOString();
    const preview = v.compiled_truth.slice(0, 80).replace(/\n/g, ' ');
    console.log(`  #${v.id}  ${date}  ${preview}...`);
  }
}

export async function runRevert(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  const versionId = args[1] ? parseInt(args[1], 10) : NaN;

  if (!slug || isNaN(versionId)) {
    console.error('Usage: gbrain revert <slug> <version-id>');
    process.exit(1);
  }

  // Create a snapshot before reverting
  await engine.createVersion(slug);

  await engine.revertToVersion(slug, versionId);
  console.log(`Reverted ${slug} to version #${versionId}`);
  console.log('Note: run gbrain embed <slug> to re-embed the reverted content');
}
