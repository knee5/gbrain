import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { GBrainStore } from "./indexer/store.js";
import { resolveConfig } from "./types/config.js";
import { executeQuery } from "./tools/query.js";
import { executeResolve } from "./tools/resolve.js";
import { registerCli } from "./cli.js";
import { createWatcherService } from "./service.js";

definePluginEntry((api) => {
  const config = resolveConfig(api.config);
  const store = new GBrainStore(config.indexPath);
  const apiKey = process.env["VOYAGE_API_KEY"] ?? "";

  // ── Tools ────────────────────────────────────────────────────────────────

  api.registerTool({
    name: "gbrain_query",
    description:
      "Search the knowledge brain semantically. Returns ranked page excerpts with source paths. " +
      "Use for any question about people, companies, deals, meetings, projects, or concepts in the brain.",
    parameters: Type.Object({
      query: Type.String({ description: "Natural language query" }),
      scope: Type.Optional(
        Type.Union([
          Type.Literal("all"),
          Type.Literal("people"),
          Type.Literal("companies"),
          Type.Literal("deals"),
          Type.Literal("meetings"),
          Type.Literal("projects"),
          Type.Literal("yc"),
          Type.Literal("civic"),
        ], { description: "Limit search to a specific directory/type" })
      ),
      limit: Type.Optional(
        Type.Number({ default: 5, minimum: 1, maximum: 20 })
      ),
      includeTimeline: Type.Optional(
        Type.Boolean({
          default: false,
          description:
            "Include timeline entries (heavier, use when asking about history)",
        })
      ),
    }),
    async execute(_id, params) {
      const result = await executeQuery(
        {
          query: params["query"] as string,
          scope: params["scope"] as "all" | "people" | "companies" | "deals" | "meetings" | "projects" | "yc" | "civic" | undefined,
          limit: params["limit"] as number | undefined,
          includeTimeline: params["includeTimeline"] as boolean | undefined,
        },
        store,
        apiKey
      );

      const lines: string[] = [];
      lines.push(
        `Found ${result.results.length} results in ${result.queryTimeMs}ms (${result.totalIndexed} pages indexed)\n`
      );

      for (const r of result.results) {
        lines.push(`## ${r.title}`);
        lines.push(`Path: ${r.path}`);
        lines.push(`Type: ${r.type} | Score: ${r.score} | Updated: ${r.updatedAt}`);
        if (r.relatedEntities.length > 0) {
          lines.push(`Related: ${r.relatedEntities.join(", ")}`);
        }
        lines.push(`\n${r.excerpt}\n`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  api.registerTool({
    name: "gbrain_resolve",
    description:
      "Resolve a name, company, or reference to its brain page path. " +
      "Uses exact match, aliases, and embedding similarity. " +
      "Returns the page path and compiled truth summary.",
    parameters: Type.Object({
      name: Type.String({
        description:
          "Entity name to resolve (e.g. 'Pedro', 'Brex', 'the Variant deal')",
      }),
      type: Type.Optional(
        Type.Union([
          Type.Literal("person"),
          Type.Literal("company"),
          Type.Literal("deal"),
          Type.Literal("meeting"),
          Type.Literal("any"),
        ], { default: "any" })
      ),
    }),
    async execute(_id, params) {
      const result = await executeResolve(
        {
          name: params["name"] as string,
          type: params["type"] as "person" | "company" | "deal" | "meeting" | "any" | undefined,
        },
        store,
        apiKey
      );

      const lines: string[] = [];

      if (result.match) {
        const m = result.match;
        lines.push(`Resolved: **${m.title}** (confidence: ${m.confidence.toFixed(2)})`);
        lines.push(`Path: ${m.path}`);
        lines.push(`Type: ${m.type} | Match: ${m.matchReason}`);
        if (m.aliases.length > 0) {
          lines.push(`Aliases: ${m.aliases.join(", ")}`);
        }
        lines.push(`\n${m.excerpt}`);
      } else {
        lines.push(`No confident match found for "${params["name"] as string}".`);
        if (result.candidates.length > 0) {
          lines.push("\nTop candidates:");
          for (const c of result.candidates) {
            lines.push(`  - ${c.title} (${c.path}) — confidence ${c.confidence.toFixed(2)}, match: ${c.matchReason}`);
          }
        }
      }

      lines.push(`\nResolved in ${result.queryTimeMs}ms`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // ── CLI ───────────────────────────────────────────────────────────────────

  api.registerCli(registerCli(store, config));

  // ── Background Service ────────────────────────────────────────────────────

  api.registerService(createWatcherService());
});
