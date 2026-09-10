import { describe, expect, it } from "vitest";
import { parseUsage } from "./usage";
import { usageBreakdown } from "./components/usage-breakdown";

describe("parseUsage", () => {
  /** 验证非法输入或无 token 时的安全处理 */
  it("returns null for null, non-object, or empty usage", () => {
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage(undefined)).toBeNull();
    expect(parseUsage("not an object")).toBeNull();
    expect(parseUsage({})).toBeNull();
    expect(parseUsage({ other: 123 })).toBeNull();
  });

  /** 验证 Claude API 格式用量解析 */
  it("parses Claude API usage format with independent cache fields", () => {
    const claudeUsage = {
      input_tokens: 1500,
      output_tokens: 350,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 500,
    };
    const parsed = parseUsage(claudeUsage);
    expect(parsed).toEqual({
      input: 1500,
      output: 350,
      cacheRead: 4000,
      cacheWrite: 500,
      total: 6350,
      contextWindow: undefined,
    });
  });

  /** 验证 OpenAI / Codex 格式用量解析，确保扣除包含的 cached tokens 避免双重累加 */
  it("parses Codex/OpenAI usage and deducts cached_input_tokens from input", () => {
    const codexUsage = {
      input_tokens: 18011,
      cached_input_tokens: 16384,
      cache_write_input_tokens: 0,
      output_tokens: 301,
      reasoning_output_tokens: 0,
      total_tokens: 18312,
      model_context_window: 828400,
    };
    const parsed = parseUsage(codexUsage);
    expect(parsed).toEqual({
      input: 18011 - 16384, // 1627: 实际未命中的常规输入
      output: 301,
      cacheRead: 16384,
      cacheWrite: 0,
      total: 18312,
      contextWindow: 828400,
    });
  });

  /** 验证 Codex 无缓存命中时的常规处理 */
  it("parses Codex usage with zero cached tokens correctly", () => {
    const codexNoCache = {
      input_tokens: 5000,
      cached_input_tokens: 0,
      output_tokens: 200,
      total_tokens: 5200,
      model_context_window: 200000,
    };
    const parsed = parseUsage(codexNoCache);
    expect(parsed).toEqual({
      input: 5000,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
      total: 5200,
      contextWindow: 200000,
    });
  });

  /** 验证 Pi / OMP 驼峰命名格式用量解析 */
  it("parses Pi / OMP usage format with camelCase keys", () => {
    const piUsage = {
      input: 1200,
      output: 300,
      cacheRead: 2500,
      cacheWrite: 0,
      totalTokens: 4000,
    };
    const parsed = parseUsage(piUsage);
    expect(parsed).toEqual({
      input: 1200,
      output: 300,
      cacheRead: 2500,
      cacheWrite: 0,
      total: 4000,
      contextWindow: undefined,
    });
  });
});

describe("usageBreakdown", () => {
  /** 验证空用量安全返回 null */
  it("returns null when usage cannot be parsed", () => {
    expect(usageBreakdown(null, 200000)).toBeNull();
  });

  /** 验证当用量中提供 model_context_window 时动态采纳并计算百分比 */
  it("uses dynamic contextWindow over default maxTokens when available", () => {
    const codexUsage = {
      input_tokens: 18011,
      cached_input_tokens: 16384,
      output_tokens: 301,
      total_tokens: 18312,
      model_context_window: 828400,
    };
    const breakdown = usageBreakdown(codexUsage, 200000);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.contextWindow).toBe(828400);
    // 18312 / 828400 ≈ 2.21% -> 2%
    expect(breakdown?.pct).toBe(2);
    // 分段中 segments 相加必须等于 total (1627 + 301 + 16384 = 18312)
    const sumSegments = breakdown?.parts.reduce((sum, p) => sum + p.tokens, 0);
    expect(sumSegments).toBe(18312);
  });

  /** 验证未携带上下文大小时回退至参数 maxTokens */
  it("falls back to provided maxTokens when contextWindow is not present", () => {
    const claudeUsage = {
      input_tokens: 10000,
      output_tokens: 2000,
      total_tokens: 12000,
    };
    const breakdown = usageBreakdown(claudeUsage, 200000);
    expect(breakdown).not.toBeNull();
    expect(breakdown?.contextWindow).toBe(200000);
    // 12000 / 200000 = 6%
    expect(breakdown?.pct).toBe(6);
  });
});
