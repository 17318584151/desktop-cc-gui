import { describe, expect, it } from "vitest";
import { mergeUsage, parseUsage } from "./usage";

describe("parseUsage", () => {
  it("reads Codex last_token_usage and model_context_window", () => {
    const parsed = parseUsage({
      total_token_usage: { input_tokens: 2_741_100, output_tokens: 11_900, total_tokens: 2_753_000 },
      last_token_usage: { input_tokens: 34_660, output_tokens: 85, total_tokens: 34_745 },
      model_context_window: 475_000,
    });
    expect(parsed).toMatchObject({
      input: 34_660,
      output: 85,
      total: 34_745,
      contextWindow: 475_000,
    });
  });

  it("reads a flattened last-turn snapshot with the window copied on", () => {
    const parsed = parseUsage({
      input_tokens: 34_660,
      output_tokens: 85,
      total_tokens: 34_745,
      model_context_window: 475_000,
    });
    expect(parsed?.contextWindow).toBe(475_000);
    expect(parsed?.total).toBe(34_745);
  });
});

describe("mergeUsage", () => {
  it("keeps a previously reported context window", () => {
    const merged = mergeUsage(
      { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      { input_tokens: 8, output_tokens: 1, total_tokens: 9, model_context_window: 475_000 },
    );
    expect(merged).toMatchObject({
      input_tokens: 10,
      total_tokens: 12,
      model_context_window: 475_000,
    });
  });
});
