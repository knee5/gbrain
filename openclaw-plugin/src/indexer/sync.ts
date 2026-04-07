import { execSync } from "child_process";
import { readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { parseMarkdown } from "./parser.js";
import { chunkPage } from "./chunker.js";
import { embedTexts } from "./embedder.js";
import { GBrainStore } from "./store.js";
import type { GBrainConfig } from "../types/config.js";

export interface SyncOptions {
  dryRun?: boolean;
  onProgress?: (indexed: number, total: number, path: string) => void;
}

/** Walk a directory recursively and collect all .md files. */
function collectMarkdownFiles(
  dir: string,
  excludeDirs: string[]
): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/** Filter to configured include directories, if any. */
function filterByDirectories(
  files: string[],
  brainPath: string,
  includeDirs: string[]
): string[] {
  if (includeDirs.length === 0) return files;
  return files.filter((f) => {
    const rel = relative(brainPath, f);
    return includeDirs.some((d) => rel.startsWith(d + "/") || rel.startsWith(d + "\\"));
  });
}

async function indexFiles(
  filePaths: string[],
  brainPath: string,
  store: GBrainStore,
  config: GBrainConfig,
  opts: SyncOptions
): Promise<void> {
  const apiKey = process.env["VOYAGE_API_KEY"] ?? "";
  const embedderOpts = { apiKey, model: config.embeddingModel };
  const total = filePaths.length;
  let indexed = 0;

  // Process in batches to avoid holding too many files in memory
  const BATCH = 20;
  for (let i = 0; i < filePaths.length; i += BATCH) {
    const batch = filePaths.slice(i, i + BATCH);

    for (const fullPath of batch) {
      const relativePath = relative(brainPath, fullPath).replace(/\\/g, "/");

      try {
        const page = parseMarkdown(fullPath, brainPath);

        // Skip unchanged files
        const existingHash = store.getContentHash(relativePath);
        if (existingHash === page.contentHash && !opts.dryRun) {
          indexed++;
          opts.onProgress?.(indexed, total, relativePath);
          continue;
        }

        if (opts.dryRun) {
          indexed++;
          opts.onProgress?.(indexed, total, relativePath);
          continue;
        }

        const chunks = chunkPage(page, config.chunkMaxTokens, config.indexTimeline);
        const texts = chunks.map((c) => c.content);
        const embeddings = apiKey
          ? await embedTexts(texts, embedderOpts)
          : texts.map(() => [] as number[]);

        const pageId = store.upsertPage(page);
        store.replaceChunks(pageId, chunks, embeddings);
        store.upsertEdges(pageId, page.relatedPaths);

        indexed++;
        opts.onProgress?.(indexed, total, relativePath);
      } catch (err) {
        // Log and skip — don't abort the whole sync for one bad file
        console.error(`[gbrain] Failed to index ${relativePath}:`, err);
        indexed++;
      }
    }
  }
}

/** Full reindex: walk all .md files in brainPath and index them. */
export async function fullReindex(
  store: GBrainStore,
  config: GBrainConfig,
  opts: SyncOptions = {}
): Promise<{ indexed: number; total: number }> {
  const allFiles = collectMarkdownFiles(config.brainPath, config.excludeDirectories);
  const filtered = filterByDirectories(allFiles, config.brainPath, config.directories);

  await indexFiles(filtered, config.brainPath, store, config, opts);

  if (!opts.dryRun) {
    store.setSyncState("last_sync_at", new Date().toISOString());
    store.setSyncState("embedding_model", config.embeddingModel);

    // Record current HEAD if in a git repo
    try {
      const head = execSync("git rev-parse HEAD", {
        cwd: config.brainPath,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      store.setSyncState("last_synced_head", head);
    } catch {
      // Not a git repo — fine
    }
  }

  return { indexed: filtered.length, total: filtered.length };
}

/** Incremental reindex: only re-index files changed between two git commits. */
export async function incrementalReindex(
  fromHead: string,
  toHead: string,
  store: GBrainStore,
  config: GBrainConfig,
  opts: SyncOptions = {}
): Promise<{ indexed: number; deleted: number }> {
  let changedFiles: string[] = [];
  let deletedFiles: string[] = [];

  try {
    const diffOutput = execSync(
      `git diff --name-status ${fromHead} ${toHead} -- "*.md"`,
      { cwd: config.brainPath, stdio: ["pipe", "pipe", "pipe"] }
    ).toString();

    for (const line of diffOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [status, ...pathParts] = trimmed.split(/\s+/);
      const filePath = pathParts.join(" ");
      if (!filePath) continue;

      if (status === "D") {
        deletedFiles.push(filePath);
      } else if (status?.match(/^[ACMR]/)) {
        changedFiles.push(filePath);
      }
    }
  } catch {
    // git diff failed — fall back to full reindex
    console.error("[gbrain] git diff failed, falling back to full reindex");
    const result = await fullReindex(store, config, opts);
    return { indexed: result.indexed, deleted: 0 };
  }

  // Handle deletions
  if (!opts.dryRun) {
    for (const filePath of deletedFiles) {
      store.deletePageByPath(filePath);
    }
  }

  // Convert relative paths to absolute for indexing
  const absolutePaths = changedFiles
    .map((f) => join(config.brainPath, f))
    .filter((f) => existsSync(f));

  await indexFiles(absolutePaths, config.brainPath, store, config, opts);

  if (!opts.dryRun) {
    store.setSyncState("last_sync_at", new Date().toISOString());
    store.setSyncState("last_synced_head", toHead);
  }

  return { indexed: absolutePaths.length, deleted: deletedFiles.length };
}

/** Get the current git HEAD of the brain repo. */
export function getCurrentHead(brainPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: brainPath,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}
