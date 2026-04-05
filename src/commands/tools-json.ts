export function printToolsJson() {
  const tools = [
    { name: 'get', description: 'Read a page by slug', parameters: { slug: 'string' } },
    { name: 'put', description: 'Write/update a page', parameters: { slug: 'string', content: 'string (markdown)' } },
    { name: 'delete', description: 'Delete a page', parameters: { slug: 'string' } },
    { name: 'list', description: 'List pages with optional filters', parameters: { type: 'string?', tag: 'string?', limit: 'number?' } },
    { name: 'search', description: 'Keyword search (tsvector)', parameters: { query: 'string' } },
    { name: 'query', description: 'Hybrid search (RRF + multi-query expansion)', parameters: { query: 'string' } },
    { name: 'import', description: 'Import markdown directory', parameters: { dir: 'string', no_embed: 'boolean?' } },
    { name: 'export', description: 'Export to markdown directory', parameters: { dir: 'string?' } },
    { name: 'embed', description: 'Generate/refresh embeddings', parameters: { slug: 'string?', all: 'boolean?', stale: 'boolean?' } },
    { name: 'tag', description: 'Add tag to page', parameters: { slug: 'string', tag: 'string' } },
    { name: 'untag', description: 'Remove tag from page', parameters: { slug: 'string', tag: 'string' } },
    { name: 'tags', description: 'List tags for a page', parameters: { slug: 'string' } },
    { name: 'link', description: 'Create typed link between pages', parameters: { from: 'string', to: 'string', type: 'string?' } },
    { name: 'unlink', description: 'Remove link between pages', parameters: { from: 'string', to: 'string' } },
    { name: 'backlinks', description: 'List incoming links to a page', parameters: { slug: 'string' } },
    { name: 'graph', description: 'Traverse link graph from a page', parameters: { slug: 'string', depth: 'number?' } },
    { name: 'timeline', description: 'View timeline entries for a page', parameters: { slug: 'string' } },
    { name: 'timeline-add', description: 'Add timeline entry', parameters: { slug: 'string', date: 'string', text: 'string' } },
    { name: 'stats', description: 'Brain statistics', parameters: {} },
    { name: 'health', description: 'Brain health dashboard', parameters: {} },
    { name: 'history', description: 'Page version history', parameters: { slug: 'string' } },
    { name: 'revert', description: 'Revert page to version', parameters: { slug: 'string', version_id: 'number' } },
    { name: 'config', description: 'Get/set brain config', parameters: { action: '"get"|"set"', key: 'string', value: 'string?' } },
  ];

  console.log(JSON.stringify(tools, null, 2));
}
