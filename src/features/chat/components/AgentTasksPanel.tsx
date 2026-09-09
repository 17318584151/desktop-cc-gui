import { memo, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { AgentProgress } from "@/components/application/agent-progress/agent-progress";
import { Collapsible } from "@/components/application/collapsible/collapsible";
import { useChatStore } from "../store";
import { deriveAgentTaskSteps, deriveEditedFiles } from "./agent-task-steps";
import type { Message } from "@/lib/ipc";

const EMPTY_MESSAGES: Message[] = [];

const EASE = [0.22, 1, 0.36, 1] as const;

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Compact "已编辑 N 个文件" card: single summary line, click to expand the
 * file list. Mirrors the reference strip's edited-files pill; rows persist
 * for the turn (no auto-hide) and only vanish when a new turn has no edits. */
function EditedFilesCard({ files, live }: { files: string[]; live: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
      transition={{ duration: 0.4, ease: EASE }}
      className="overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default shadow-xs"
      data-testid="edited-files-card"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-3.5 shrink-0 text-foreground-icon-secondary"
        >
          <path
            d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 1.237-8.61 8.61a.25.25 0 0 0-.063.108l-.62 2.168 2.168-.62a.25.25 0 0 0 .108-.064l8.61-8.61a.25.25 0 0 0 0-.354l-1.086-1.086a.25.25 0 0 0-.354 0Z"
            fill="currentColor"
          />
        </svg>
        <span className="flex-1 text-body-medium text-text-secondary">
          {t("chat.editedFiles", { count: files.length })}
        </span>
        {live && (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground-icon-secondary" />
        )}
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className={`size-3 shrink-0 text-foreground-icon-secondary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Collapsible open={open} seconds={0.28}>
        {open && (
          <div className="flex flex-col gap-0.5 px-3.5 pt-0 pb-2.5">
              {files.map((file, index) => (
                <motion.div
                  key={file}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * index, duration: 0.24, ease: EASE }}
                  className="flex h-7 items-center gap-2 text-body-medium text-text-primary"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-background-quaternary-default" />
                  <span className="truncate" title={file}>
                    {baseName(file)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption-1-regular text-text-tertiary">
                    {file}
                  </span>
                </motion.div>
              ))}
          </div>
        )}
      </Collapsible>
    </motion.div>
  );
}

/**
 * Run-status surface above the composer: live subagent/task steps plus the
 * turn's edited files.
 *
 * Lifecycle follows the reference app's interaction contract: rows NEVER
 * auto-hide — a completed panel stays put while the user reads the result,
 * and only exits (animated) when a newer turn contributes neither subagent
 * spawns nor file edits.
 *
 * Owns its bySession subscription (same boundary pattern as SessionTimeline)
 * so per-frame stream flushes re-render this small subtree, never the
 * composer/footer.
 */
export const AgentTasksPanel = memo(function AgentTasksPanel({
  sessionKey,
  engine,
}: {
  sessionKey: string;
  engine: string;
}) {
  const { t } = useTranslation();
  const messages = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.messages ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const streaming = useChatStore((s) =>
    sessionKey ? (s.bySession[sessionKey]?.streaming ?? false) : false,
  );
  const steps = useMemo(
    () => deriveAgentTaskSteps(messages, streaming, engine),
    [messages, streaming, engine],
  );
  const files = useMemo(() => deriveEditedFiles(messages), [messages]);

  const allComplete = steps.length > 0 && steps.every((step) => step.state === "complete");
  const remaining = steps.filter((step) => step.state !== "complete").length;
  const statusLabel = allComplete
    ? t("chat.agentTasksDone")
    : t("chat.agentTasksLeft", { count: remaining });

  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {steps.length > 0 && (
          <AgentProgress
            key="subagents"
            steps={steps}
            statusLabel={statusLabel}
            expandLabel={t("chat.agentTasksExpand")}
            minimizeLabel={t("chat.agentTasksMinimize")}
          />
        )}
        {files.length > 0 && (
          <EditedFilesCard key="files" files={files} live={streaming} />
        )}
      </AnimatePresence>
    </div>
  );
});
