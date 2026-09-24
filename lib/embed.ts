// Embedding a search query, the one model call the application makes at
// runtime (docs/ARCHITECTURE.md §8).
//
// MODEL, DIMENSION AND INPUT TYPE MUST MATCH THE CORPUS. The chunks were
// embedded by pipeline/embed.py with DEFAULT_MODEL 'voyage-4', DEFAULT_DIM 1024
// and input_type 'document'; a query is embedded with the same model and
// dimension and input_type 'query'. Change one side and every score is
// meaningless without any error to say so. pipeline/search.py's embed_query is
// the Python twin of this function.
//
// A plain fetch to Voyage's REST endpoint (docs.voyageai.com/reference/
// embeddings-api) rather than their SDK: one call, no dependency.

export const EMBED_MODEL = 'voyage-4';
export const EMBED_DIM = 1024;

export async function embedQuery(text: string): Promise<number[]> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY is not set');

  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: [text],
      model: EMBED_MODEL,
      input_type: 'query',
      output_dimension: EMBED_DIM,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Voyage embeddings: HTTP ${res.status}`);

  const body = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vector = body.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBED_DIM) {
    throw new Error('Voyage embeddings: unexpected response');
  }
  return vector;
}
