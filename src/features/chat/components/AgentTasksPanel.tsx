import { memo, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { AgentProgress } from "@/components/application/agent-progress/agent-progress";
import { useChatStore } from "../store";
import { deriveAgentTaskSteps } from "./agent-task-steps";
import type { Message } from "@/lib/ipc";

const EMPTY_MESSAGES: Message[] = [];
/** How long the all-complete state stays before the panel slides out. */
const DONE_LINGER_MS = 2600;

/**
 * Live subagent/task progress above the composer. Owns its bySession
 * subscription (same boundary pattern as SessionTimeline) so per-frame
 * stream flushes re-render this small subtree, never the composer/footer.
 */
export const AgentTasksPanel = memo(function AgentTasksPanel({
  sessionKey,
}: {
  sessionKey: string;
}) {
  const { t } = useTranslation();
  const messages = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.messages ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const streaming = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.streaming ?? false) : false,
  );
  const steps = useMemo(() => deriveAgentTaskSteps(messages, streaming), [messages, streaming]);

  const allComplete = steps.length > 0 && steps.every((step) => step.state === "complete");
  // Linger on the all-complete state, then slide out. The signature embeds
  // per-message seq keys, so a new turn (or a new spawn in the same turn)
  // changes it and makes the panel visible again.
  const signature = steps.map((step) => `${step.key}:${step.state}`).join("|");
  const [hiddenSignature, setHiddenSignature] = useState<string | null>(null);
  useEffect(() => {
    if (!allComplete) return;
    const id = window.setTimeout(() => setHiddenSignature(signature), DONE_LINGER_MS);
    return () => window.clearTimeout(id);
  }, [allComplete, signature]);
  const visible = steps.length > 0 && hiddenSignature !== signature;

  const remaining = steps.filter((step) => step.state !== "complete").length;
  const statusLabel = allComplete
    ? t("chat.agentTasksDone")
    : t("chat.agentTasksLeft", { count: remaining });

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <AgentProgress
          steps={steps}
          statusLabel={statusLabel}
          expandLabel={t("chat.agentTasksExpand")}
          minimizeLabel={t("chat.agentTasksMinimize")}
        />
      )}
    </AnimatePresence>
  );
});
