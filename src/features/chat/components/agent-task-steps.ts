import type { Message, TodoItem } from "@/lib/ipc";

export type AgentTaskStepState = "active" | "complete";

export interface AgentTaskStep {
  /** Stable identity across renders (steps only append within a run). */
  key: string;
  label: string;
  state: AgentTaskStepState;
}

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

/** Edit-class tool labels (write/edit/patch families) — the file
 * modification surface. Mirrors the edit branch of ProcessDisclosure's
 * toolTypeKey. */
export function isEditToolLabel(text: string): boolean {
  const head = text.split("·")[0].trim().toLowerCase();
  const first = head.split(/[\s/\\]+/)[0].replace(/-/g, "_");
  return [
    "write",
    "edit",
    "write_file",
    "edit_file",
    "apply_patch",
    "patch",
    "notebook_edit",
    "multiedit",
    "multi_edit",
  ].includes(first);
}

/** Index just past the last user message — the start of the current turn. */
function currentTurnStart(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}

/**
 * Fold the current turn's subagent tool rows into panel steps.
 *
 * Completion is deliberately conservative — the stream carries tool-call
 * STARTS only (no outputs, no task notifications), so a spawn stays active
 * until its result provably came back:
 * - a later assistant/thinking row means the model received the result and
 *   moved on (covers non-blocking spawn + hub-wait flows: the wait tool row
 *   itself must NOT settle the spawn);
 * - Claude's Task is blocking, so for claude ANY later row settles it;
 * - the turn ending settles everything.
 * Spawns never settle on unrelated tool rows — that was the flash bug.
 */
export function deriveAgentTaskSteps(
  messages: Message[],
  streaming: boolean,
  engine: string,
): AgentTaskStep[] {
  const turnStart = currentTurnStart(messages);
  const blockingSpawn = engine === "claude";
  const steps: AgentTaskStep[] = [];
  for (let i = turnStart; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool" || !isSubagentToolLabel(message.text)) continue;
    let settled = !streaming;
    if (!settled) {
      for (let j = i + 1; j < messages.length; j++) {
        const later = messages[j];
        if (later.role === "assistant" || later.role === "thinking") {
          settled = true;
          break;
        }
        if (blockingSpawn) {
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

/**
 * Unique files touched by edit-class tools across the whole loaded session,
 * in first-edit order — the reference app's contract: the 已编辑 pill is
 * session-scoped (survives turn boundaries and history reopen), not
 * turn-scoped. Paths come from the tool start's path arg, so only edits
 * with a real file target count.
 */
export function deriveEditedFiles(messages: Message[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "tool" || !message.path) continue;
    if (!isEditToolLabel(message.text)) continue;
    // Tool rows also record non-file targets (xd:// device endpoints, URLs)
    // — real file paths never carry a URI scheme.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(message.path)) continue;
    if (seen.has(message.path)) continue;
    seen.add(message.path);
    files.push(message.path);
  }
  return files;
}

/**
 * Fold todo tool payloads across the whole loaded session into the current
 * list. Two wire semantics: `replace` snapshots swap the list outright
 * (TodoWrite-style full rewrites, init/clear ops); otherwise the payload is
 * a patch matched by content (start/done/block/unblock), and "dropped"
 * removes the item. Session-scoped like the edited-files pill.
 */
export function deriveTodoList(messages: Message[]): TodoItem[] {
  let items: TodoItem[] = [];
  for (const message of messages) {
    const payload = message.todos;
    if (!payload) continue;
    if (payload.replace) {
      items = payload.items.filter((item) => item.status !== "dropped");
      continue;
    }
    for (const patch of payload.items) {
      const idx = items.findIndex((item) => item.content === patch.content);
      if (patch.status === "dropped") {
        if (idx >= 0) items = items.filter((_, j) => j !== idx);
        continue;
      }
      if (idx >= 0) items[idx] = patch;
      else items = [...items, patch];
    }
  }
  return items;
}
