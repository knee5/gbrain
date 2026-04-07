import type { CliContext } from "openclaw/plugin-sdk/plugin-entry";
import { fullReindex, incrementalReindex, getCurrentHead } from "./indexer/sync.js";
import type { GBrainStore } from "./indexer/store.js";
import type { GBrainConfig } from "./types/config.js";
import { executeQuery } from "./tools/query.js";
import { executeResolve } from "./tools/resolve.js";

export function registerCli(store: GBrainStore, config: GBrainConfig) {
  return async ({ program }: CliContext): Promise<void> => {
    const gbrain = program.command("gbrain").description("Knowledge brain management");

    // openclaw gbrain status
    gbrain.command("status")
      .description("Show index stats and configuration")
      .action(async () => {
        const stats = store.getStats();
        const head = getCurrentHead(config.brainPath);

        console.log("\nGBrain Index Status");
        console.log("═══════════════════════════════════════");
        console.log(`Brain path:      ${config.brainPath}`);
        console.log(`Index path:      ${config.indexPath}`);
        console.log(`Pages indexed:   ${stats.pageCount.toLocaleString()}`);
        console.log(`Chunks:          ${stats.chunkCount.toLocaleString()}`);
        console.log(`Relationship edges: ${stats.edgeCount.toLocaleString()}`);
        console.log(
          `Index size:      ${formatBytes(stats.indexSizeBytes)}`
        );
        console.log(`Last sync:       ${stats.lastSync ?? "never"}`);
        console.log(`Embedding model: ${stats.embeddingModel ?? "not set"}`);
        console.log(`Current HEAD:    ${head ?? "not a git repo"}`);
        console.log(`Timeline indexed: ${config.indexTimeline ? "yes" : "no"}`);
        console.log("");
      });

    // openclaw gbrain reindex [--full] [--dry-run]
    gbrain.command("reindex")
      .description("Rebuild the knowledge brain index")
      .option("--full", "Force full reindex (ignore sync state)")
      .option("--dry-run", "Show what would be reindexed without making changes")
      .action(async (...args: unknown[]) => {
        const opts = args[args.length - 1] as Record<string, unknown>;
        const full = Boolean(opts["full"]);
        const dryRun = Boolean(opts["dry-run"] ?? opts["dryRun"]);

        if (dryRun) {
          console.log("[gbrain] Dry run — no changes will be made.");
        }

        const lastHead = store.getSyncState("last_synced_head");
        const currentHead = getCurrentHead(config.brainPath);

        if (!full && lastHead && currentHead && lastHead !== currentHead) {
          console.log(`[gbrain] Incremental reindex: ${lastHead.slice(0, 8)} → ${currentHead.slice(0, 8)}`);
          const result = await incrementalReindex(
            lastHead,
            currentHead,
            store,
            config,
            {
              dryRun,
              onProgress: (indexed, total, path) => {
                if (indexed % 10 === 0 || indexed === total) {
                  console.log(`[gbrain] ${indexed}/${total} — ${path}`);
                }
              },
            }
          );
          console.log(
            `[gbrain] Done. Indexed ${result.indexed} files, deleted ${result.deleted}.`
          );
        } else {
          if (!full) {
            console.log("[gbrain] No prior sync state — running full reindex.");
          } else {
            console.log("[gbrain] Full reindex requested.");
          }

          const result = await fullReindex(store, config, {
            dryRun,
            onProgress: (indexed, total, path) => {
              if (indexed % 100 === 0 || indexed === total) {
                console.log(`[gbrain] ${indexed}/${total} — ${path}`);
              }
            },
          });
          console.log(
            `[gbrain] Done. Indexed ${result.indexed} / ${result.total} files.`
          );
        }
      });

    // openclaw gbrain query <query>
    gbrain.command("query")
      .description("Run a semantic query against the brain")
      .option("--scope <scope>", "Limit to directory (people, companies, etc.)")
      .option("--limit <n>", "Max results", "5")
      .action(async (...args: unknown[]) => {
        const [queryStr, opts] = args as [string, Record<string, unknown>];
        const apiKey = process.env["VOYAGE_API_KEY"] ?? "";
        if (!apiKey) {
          console.error("[gbrain] VOYAGE_API_KEY not set");
          return;
        }

        const result = await executeQuery(
          {
            query: queryStr,
            scope: opts["scope"] as "all" | undefined,
            limit: parseInt(String(opts["limit"] ?? "5"), 10),
          },
          store,
          apiKey
        );

        console.log(
          `\n${result.results.length} results (${result.queryTimeMs}ms, ${result.totalIndexed} pages indexed)\n`
        );
        for (const r of result.results) {
          console.log(`[${r.score.toFixed(3)}] ${r.title} — ${r.path}`);
          console.log(`       ${r.excerpt.replace(/\n/g, " ").slice(0, 120)}`);
          console.log("");
        }
      });

    // openclaw gbrain resolve <name>
    gbrain.command("resolve")
      .description("Resolve a name or reference to its brain page")
      .action(async (...args: unknown[]) => {
        const [nameStr] = args as [string];
        const apiKey = process.env["VOYAGE_API_KEY"] ?? "";

        const result = await executeResolve(
          { name: nameStr },
          store,
          apiKey
        );

        if (result.match) {
          console.log(`\nResolved: ${result.match.title} (${result.match.confidence.toFixed(2)} confidence)`);
          console.log(`Path: ${result.match.path}`);
          console.log(`Match reason: ${result.match.matchReason}`);
          if (result.match.aliases.length > 0) {
            console.log(`Aliases: ${result.match.aliases.join(", ")}`);
          }
          console.log(`\n${result.match.excerpt}`);
        } else {
          console.log(`\nNo confident match found for "${nameStr}".`);
          if (result.candidates.length > 0) {
            console.log("Candidates:");
            for (const c of result.candidates) {
              console.log(
                `  [${c.confidence.toFixed(2)}] ${c.title} — ${c.path} (${c.matchReason})`
              );
            }
          }
        }
      });
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
