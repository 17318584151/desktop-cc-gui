import type { EngineIconId } from "./engine-icon";

/** Brand names stay literal in every locale (Claude Code, Codex CLI, …). */
export const CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  grok: "Grok CLI",
  kimi: "Kimi CLI",
  pi: "PI CLI",
  omp: "OMP CLI",
  dsh: "DeepSeek Harness",
};

/**
 * Infer a provider brand from a model name so cross-provider engines
 * (e.g. OMP CLI serving Kimi K3) show the model's own mark in the model
 * list instead of the engine's. Returns null when no brand matches —
 * callers fall back to the engine icon.
 */
export function inferModelEngine(name: string): EngineIconId | null {
  const lower = name.toLowerCase();
  if (/\b(claude|sonnet|opus|haiku)\b/.test(lower)) return "claude";
  if (/\b(gpt|codex|openai)\b/.test(lower) || /\bo[134]\b/.test(lower)) return "codex";
  if (/\bgrok\b/.test(lower)) return "grok";
  if (/\b(kimi|moonshot)\b/.test(lower) || /\bk\d/.test(lower)) return "kimi";
  if (/\bdeepseek\b/.test(lower)) return "dsh";
  return null;
}
