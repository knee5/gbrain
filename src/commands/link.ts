import type { BrainEngine } from '../core/engine.ts';

export async function runLink(engine: BrainEngine, args: string[]) {
  const from = args[0];
  const to = args[1];
  const typeIdx = args.indexOf('--type');
  const linkType = typeIdx !== -1 ? args[typeIdx + 1] : '';

  if (!from || !to) {
    console.error('Usage: gbrain link <from> <to> [--type <type>]');
    process.exit(1);
  }

  await engine.addLink(from, to, '', linkType);
  console.log(`Linked ${from} -> ${to}${linkType ? ` (${linkType})` : ''}`);
}

export async function runUnlink(engine: BrainEngine, args: string[]) {
  const [from, to] = args;
  if (!from || !to) {
    console.error('Usage: gbrain unlink <from> <to>');
    process.exit(1);
  }
  await engine.removeLink(from, to);
  console.log(`Unlinked ${from} -> ${to}`);
}

export async function runBacklinks(engine: BrainEngine, args: string[]) {
  const slug = args[0];
  if (!slug) {
    console.error('Usage: gbrain backlinks <slug>');
    process.exit(1);
  }

  const links = await engine.getBacklinks(slug);
  if (links.length === 0) {
    console.log(`No backlinks to ${slug}`);
    return;
  }

  for (const l of links) {
    const typeStr = l.link_type ? ` (${l.link_type})` : '';
    console.log(`${l.from_slug}${typeStr}`);
  }
  console.log(`\n${links.length} backlinks`);
}

export async function runGraph(engine: BrainEngine, args: string[]) {
  const slug = args.find(a => !a.startsWith('--'));
  const depthIdx = args.indexOf('--depth');
  const depth = depthIdx !== -1 ? parseInt(args[depthIdx + 1], 10) : 5;

  if (!slug) {
    console.error('Usage: gbrain graph <slug> [--depth N]');
    process.exit(1);
  }

  const nodes = await engine.traverseGraph(slug, depth);

  for (const node of nodes) {
    const indent = '  '.repeat(node.depth);
    const links = node.links.map(l => `${l.to_slug}${l.link_type ? `(${l.link_type})` : ''}`);
    console.log(`${indent}${node.slug} [${node.type}]`);
    if (links.length > 0) {
      console.log(`${indent}  -> ${links.join(', ')}`);
    }
  }
}
