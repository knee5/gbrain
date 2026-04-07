export interface GBrainConfig {
  brainPath: string;
  indexPath: string;
  embeddingModel: string;
  indexTimeline: boolean;
  watchInterval: number;
  chunkMaxTokens: number;
  directories: string[];
  excludeDirectories: string[];
}

export const DEFAULT_CONFIG: GBrainConfig = {
  brainPath: "/data/brain",
  indexPath: "/data/db/gbrain.db",
  embeddingModel: "auto",
  indexTimeline: false,
  watchInterval: 30,
  chunkMaxTokens: 1000,
  directories: [],
  excludeDirectories: [".raw", ".git", "node_modules"],
};

export function resolveConfig(raw: Record<string, unknown>): GBrainConfig {
  return {
    brainPath: (raw["brainPath"] as string) ?? DEFAULT_CONFIG.brainPath,
    indexPath: (raw["indexPath"] as string) ?? DEFAULT_CONFIG.indexPath,
    embeddingModel: (raw["embeddingModel"] as string) ?? DEFAULT_CONFIG.embeddingModel,
    indexTimeline: (raw["indexTimeline"] as boolean) ?? DEFAULT_CONFIG.indexTimeline,
    watchInterval: (raw["watchInterval"] as number) ?? DEFAULT_CONFIG.watchInterval,
    chunkMaxTokens: (raw["chunkMaxTokens"] as number) ?? DEFAULT_CONFIG.chunkMaxTokens,
    directories: (raw["directories"] as string[]) ?? DEFAULT_CONFIG.directories,
    excludeDirectories: (raw["excludeDirectories"] as string[]) ?? DEFAULT_CONFIG.excludeDirectories,
  };
}
