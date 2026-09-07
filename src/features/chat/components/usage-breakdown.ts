import { parseUsage } from "../usage";

type UsagePartKind = "input" | "output" | "cacheRead" | "cacheWrite" | "total";

export const USAGE_PART_LABEL_KEYS: Record<UsagePartKind, string> = {
  input: "chat.usageInput",
  output: "chat.usageOutput",
  cacheRead: "chat.usageCacheRead",
  cacheWrite: "chat.usageCacheWrite",
  total: "chat.usageTokens",
};

export interface UsageBreakdown {
  pct: number;
  parts: { kind: UsagePartKind; tokens: number }[];
}

export function usageBreakdown(usage: unknown, maxTokens: number): UsageBreakdown | null {
  const u = parseUsage(usage);
  if (!u) return null;
  const parts = [
    { kind: "input" as const, tokens: u.input },
    { kind: "output" as const, tokens: u.output },
    { kind: "cacheRead" as const, tokens: u.cacheRead },
    { kind: "cacheWrite" as const, tokens: u.cacheWrite },
  ].filter((p) => p.tokens > 0);
  return {
    pct: Math.min(100, Math.round((u.total / maxTokens) * 100)),
    parts: parts.length ? parts : [{ kind: "total", tokens: u.total }],
  };
}
