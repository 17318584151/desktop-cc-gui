import type { Message } from "@/lib/ipc";
import type { AgentProgressStep } from "@/components/application/agent-progress/agent-progress";

/**
 * Live subagent/task detection from the message stream.
 *
 * Engine events carry tool calls as `role: "tool"` rows whose text is the
 * tool label (engine-dependent: Claude "Task", pi-family "task · intent",
 * Codex/Grok spawn_* names, Kimi agent swarm). There is no dedicated
 * subagent event kind, so the panel derives its steps from these labels —
 * matching the reference project's cross-engine spawn-tool matcher.
 */
export function isSubagentToolLabel(text: string): boolean {
  // pi-family labels are "name · intent" — match on the tool name head.
  const head = text.split("·")[0].trim().toLowerCase();
  const first = head.split(/[\s/\\]+/)[0].replace(/-/g, "_");
  if (first === "task" || first === "agent" || first === "subagent") return true;
  if (first === "spawn" || first === "spawn_agent" || first === "spawn_subagent") return true;
  if (/^subagent\s*\d+/.test(head)) return true;
  if (head.includes("spawn agent") || head.includes("spawn subagent")) return true;
  if (head.includes("agent swarm") || head.includes("agent_swarm")) return true;
  return false;
}

/**
 * Fold the current turn's subagent tool rows into panel steps.
 *
 * A spawn stays "active" until any later non-subagent row arrives (blocking
 * spawn returned) or the turn settles. Consecutive subagent rows with no
 * intervening row are parallel spawns and stay active together.
 */
export function deriveAgentTaskSteps(
  messages: Message[],
  streaming: boolean,
): AgentProgressStep[] {
  let turnStart = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      turnStart = i + 1;
      break;
    }
  }
  const steps: AgentProgressStep[] = [];
  for (let i = turnStart; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool" || !isSubagentToolLabel(message.text)) continue;
    let settled = !streaming;
    if (!settled) {
      for (let j = i + 1; j < messages.length; j++) {
        const later = messages[j];
        if (later.role !== "tool" || !isSubagentToolLabel(later.text)) {
          settled = true;
          break;
        }
      }
    }
    steps.push({
      key: String(message.seq),
      label: message.text,
      state: settled ? "complete" : "active",
    });
  }
  return steps;
}
