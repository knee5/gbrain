const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";
const VOYAGE_DIMENSIONS = 1024;
const BATCH_SIZE = 100;

export interface EmbedderOptions {
  apiKey: string;
  model?: string;
}

interface VoyageEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

async function callVoyageApi(
  texts: string[],
  apiKey: string,
  model: string
): Promise<number[][]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Voyage API error ${response.status}: ${errorText}`
    );
  }

  const result = (await response.json()) as VoyageEmbeddingResponse;
  // Sort by index to ensure correct ordering
  const sorted = result.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Embed a batch of texts using the Voyage API.
 * Automatically batches requests to stay within the 100-text-per-request limit.
 */
export async function embedTexts(
  texts: string[],
  options: EmbedderOptions
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const model = options.model && options.model !== "auto"
    ? options.model
    : VOYAGE_MODEL;

  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await callVoyageApi(batch, options.apiKey, model);
    results.push(...embeddings);
  }

  return results;
}

/**
 * Embed a single query string.
 */
export async function embedQuery(
  query: string,
  options: EmbedderOptions
): Promise<number[]> {
  const [embedding] = await embedTexts([query], options);
  if (!embedding) throw new Error("No embedding returned for query");
  return embedding;
}

export { VOYAGE_DIMENSIONS };
