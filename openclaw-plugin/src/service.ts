import type { PluginService, ServiceContext } from "openclaw/plugin-sdk/plugin-entry";
import { getCurrentHead, incrementalReindex } from "./indexer/sync.js";
import { GBrainStore } from "./indexer/store.js";
import { resolveConfig } from "./types/config.js";

export function createWatcherService(): PluginService {
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let store: GBrainStore | null = null;

  return {
    id: "gbrain-watcher",

    async start(ctx: ServiceContext): Promise<void> {
      const config = resolveConfig(ctx.config);
      store = new GBrainStore(config.indexPath);

      const pollMs = config.watchInterval * 1000;
      let lastHead = store.getSyncState("last_synced_head");

      // Sync on startup if we have a recorded head
      const currentHead = getCurrentHead(config.brainPath);
      if (currentHead && lastHead && currentHead !== lastHead) {
        console.log(
          `[gbrain-watcher] Detected ${currentHead.slice(0, 8)} vs last synced ${lastHead.slice(0, 8)} — running incremental reindex on start`
        );
        try {
          await incrementalReindex(lastHead, currentHead, store, config);
          lastHead = currentHead;
        } catch (err) {
          console.error("[gbrain-watcher] Startup reindex failed:", err);
        }
      } else if (currentHead) {
        lastHead = currentHead;
      }

      intervalHandle = setInterval(async () => {
        try {
          const head = getCurrentHead(config.brainPath);
          if (!head) return; // Not a git repo

          if (head !== lastHead) {
            const from = lastHead ?? head;
            console.log(
              `[gbrain-watcher] Brain repo changed: ${from.slice(0, 8)} → ${head.slice(0, 8)}`
            );
            await incrementalReindex(from, head, store!, config);
            lastHead = head;
          }
        } catch (err) {
          console.error("[gbrain-watcher] Poll error:", err);
        }
      }, pollMs);

      console.log(
        `[gbrain-watcher] Started. Polling every ${config.watchInterval}s for changes in ${config.brainPath}`
      );
    },

    async stop(): Promise<void> {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
      if (store) {
        store.close();
        store = null;
      }
      console.log("[gbrain-watcher] Stopped.");
    },
  };
}
