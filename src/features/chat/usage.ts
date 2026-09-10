export interface ParsedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  contextWindow?: number;
}

/** Normalize the per-engine usage shapes (snake_case for claude/codex, bare
 * keys for pi/omp) into one token breakdown. Returns null when no tokens
 * were reported at all. */
export function parseUsage(usage: unknown): ParsedUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const num = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  const rawInput = num("input_tokens") || num("input") || num("inputTokens");
  const output = num("output_tokens") || num("output") || num("outputTokens");
  const cacheRead =
    num("cache_read_input_tokens") ||
    num("cached_input_tokens") ||
    num("cacheRead") ||
    num("cachedInputTokens");
  const cacheWrite =
    num("cache_creation_input_tokens") ||
    num("cache_write_input_tokens") ||
    num("cacheWrite") ||
    num("cacheWriteInputTokens");

  // In OpenAI/Codex APIs, `input_tokens` already includes `cached_input_tokens`
  // (e.g. input_tokens: 18011, cached_input_tokens: 16384, total: 18312).
  // Deduct cacheRead from rawInput if rawInput is already inclusive so that
  // segments in the stacked bar chart don't double-count cached tokens.
  const hasCodexInclusiveCache =
    typeof u["cached_input_tokens"] === "number" ||
    (rawInput >= cacheRead &&
      cacheRead > 0 &&
      typeof u["total_tokens"] === "number" &&
      rawInput + output === (u["total_tokens"] as number));

  const input =
    hasCodexInclusiveCache && rawInput >= cacheRead ? rawInput - cacheRead : rawInput;

  const total =
    num("total_tokens") ||
    num("totalTokens") ||
    input + cacheRead + cacheWrite + output;
  if (!total) return null;

  const contextWindow =
    num("model_context_window") ||
    num("modelContextWindow") ||
    num("context_window") ||
    num("contextWindow") ||
    undefined;

  return { input, output, cacheRead, cacheWrite, total, contextWindow };
}
