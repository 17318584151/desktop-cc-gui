import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Composer,
  StatusBar,
  type ComposerInputHandle,
} from "@/components/application/ai-chat/ai-chat-composer";
import { MessageQueue } from "@/components/application/ai-chat/message-queue";
import type { ContextSegment } from "@/components/application/agent-limits/agent-limits-card";
import type { BranchInfo, Workspace } from "@/lib/ipc";
import type { ActiveSession, QueuedMessage } from "../store";
import { useChatStore } from "../store";
import { ImageLightbox } from "./MessageImages";
import { AgentTasksPanel } from "./AgentTasksPanel";
import { sessionKey } from "../store";
import { ComposerSlotExtras } from "@/features/plugins/boundary/composer-slot-extras";
import { COMPOSER_DRAFT_TOPIC, pluginBus } from "@/features/plugins/runtime/events";
import { USAGE_PART_LABEL_KEYS, usageBreakdown } from "./usage-breakdown";

/** Path → trailing name (folder or file) for status-bar and chip labels.
 *  Both separators: workspace/attachment paths are native — backslashes on
 *  Windows — matching fileName in features/files/store. */
function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Bottom column of the conversation: the message queue, error banners,
 * attachment chips, the composer, and the branch/folder/usage status bar. */
export function ConversationFooter({
  active,
  workspaces,
  queue,
  onRemoveQueued,
  onClearQueued,
  imageError,
  branchError,
  onDismissImageError,
  onDismissBranchError,
  images,
  previews,
  onRemoveImage,
  draft,
  onDraftChange,
  onSubmit,
  sendShortcut,
  onStop,
  streaming,
  noEnabledEngines,
  composerInputRef,
  addMenu,
  cliMenu,
  permissionMenu,
  supportsImages,
  onPasteImages,
  sessionUsage,
  contextMax,
  branch,
  branches,
  onBranchSelect,
  startNewChat,
}: {
  active: ActiveSession | null;
  workspaces: Workspace[];
  queue: QueuedMessage[];
  onRemoveQueued: (id: string) => void;
  onClearQueued?: () => void;
  imageError: string | null;
  branchError: string | null;
  onDismissImageError: () => void;
  onDismissBranchError: () => void;
  images: string[];
  previews: Record<string, { url: string; name: string }>;
  onRemoveImage: (path: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  sendShortcut: string;
  onStop: () => void;
  streaming: boolean;
  noEnabledEngines: boolean;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
  addMenu: ReactNode;
  cliMenu: ReactNode;
  permissionMenu: ReactNode;
  supportsImages: boolean;
  onPasteImages: (files: File[]) => void;
  sessionUsage: unknown;
  contextMax: number;
  branch: string | undefined;
  branches: BranchInfo[] | undefined;
  onBranchSelect: (name: string) => void;
  startNewChat: (workspacePath: string) => void;
}) {
  const { t } = useTranslation();
  /** Composer attachment chip lightbox: preview URL + display name. */
  const [zoomImage, setZoomImage] = useState<{ src: string; name: string } | null>(null);
  // Same denominator as the breakdown card (contextMax), so the ring pill
  // and the card never disagree.
  const usage = useMemo(
    () => usageBreakdown(sessionUsage, contextMax),
    [sessionUsage, contextMax],
  );
  const contextSegments: ContextSegment[] | undefined = useMemo(
    () =>
      usage?.parts.map((p) => ({
        label: t(USAGE_PART_LABEL_KEYS[p.kind]),
        tokens: p.tokens,
      })),
    [usage, t],
  );
  // The quick-switch folder chip mirrors the sidebar: archived workspaces
  // stay hidden until unarchived.
  const archivedWorkspaces = useChatStore((s) => s.archivedWorkspaces);
  const visibleWorkspaces = useMemo(
    () => workspaces.filter((w) => !archivedWorkspaces.includes(w.id)),
    [workspaces, archivedWorkspaces],
  );
  const statusFolders = useMemo(() => visibleWorkspaces.map((w) => baseName(w.path)), [visibleWorkspaces]);
  const handleFolderSelect = useCallback(
    (name: string) => {
      const target = visibleWorkspaces.find((w) => baseName(w.path) === name);
      if (target) startNewChat(target.path);
    },
    [visibleWorkspaces, startNewChat],
  );

  // The draft prop is the store's per-session value, so watching it covers
  // every change source at once: typing, submit-clear, and session switches
  // all re-emit with the latest text (empty string included).
  useEffect(() => {
    pluginBus.emit(COMPOSER_DRAFT_TOPIC, { text: draft });
  }, [draft]);

  return (
    <>
      <div
        className="flex w-full flex-col gap-2.5 bg-background-primary-default px-4 pt-2.5 pb-2"
      >
        <MessageQueue queue={queue} onRemove={onRemoveQueued} onClear={onClearQueued} className="mx-auto w-full max-w-3xl" />
        {imageError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-border-error-default bg-background-tertiary-error px-3 py-2 text-body-regular text-text-error-primary"
          >
            <span className="min-w-0 flex-1 break-all">{imageError}</span>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={onDismissImageError}
              className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background-tertiary-hover"
            >
              ×
            </button>
          </div>
        )}
        {branchError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-border-error-default bg-background-tertiary-error px-3 py-2 text-body-regular text-text-error-primary"
          >
            <span className="min-w-0 flex-1 break-all">{branchError}</span>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={onDismissBranchError}
              className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background-tertiary-hover"
            >
              ×
            </button>
          </div>
        )}
        {images.length > 0 && (
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex flex-wrap gap-1.5">
              {images.map((path) => {
                const preview = previews[path];
                return (
                  <span
                    key={path}
                    className="inline-flex items-center rounded-full bg-background-tertiary-default text-caption-1-medium text-text-secondary"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        preview &&
                        setZoomImage({ src: preview.url, name: preview.name })
                      }
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-l-full py-0.5 pl-0.5"
                      aria-label={preview?.name ?? baseName(path)}
                    >
                      {preview && (
                        <img
                          src={preview.url}
                          alt=""
                          className="size-6 shrink-0 rounded-full object-cover"
                        />
                      )}
                      <span className="max-w-48 truncate">
                        {preview?.name ?? baseName(path)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t("common.close")}
                      onClick={() => onRemoveImage(path)}
                      className="cursor-pointer rounded-r-full py-0.5 pr-2 pl-1 hover:text-text-primary"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="mx-auto w-full max-w-3xl">
          <AgentTasksPanel
            sessionKey={active ? sessionKey(active.engine, active.sessionId, active.workspacePath) : ""}
            engine={active?.engine ?? ""}
          />
        </div>
        <Composer
          className="mx-auto max-w-3xl"
          value={draft}
          onValueChange={onDraftChange}
          onSubmit={onSubmit}
          sendShortcut={sendShortcut === "cmdEnter" ? "cmdEnter" : "enter"}
          onStop={onStop}
          streaming={streaming}
          disabled={!active || noEnabledEngines || (!draft.trim() && images.length === 0)}
          inputRef={composerInputRef}
          addMenu={<>{addMenu}<ComposerSlotExtras slot="addMenu" /></>}
          cliMenu={<>{cliMenu}<ComposerSlotExtras slot="cliMenu" /></>}
          permissionMenu={<>{permissionMenu}<ComposerSlotExtras slot="permissionMenu" /></>}
          onPasteImages={supportsImages ? onPasteImages : undefined}
          workspacePath={active?.workspacePath}
        />
        <div className="mx-auto w-full max-w-3xl">
          <StatusBar
            branch={branch}
            branches={branches}
            onBranchSelect={onBranchSelect}
            folders={statusFolders}
            selectedFolder={active ? baseName(active.workspacePath) : undefined}
            onFolderSelect={handleFolderSelect}
            usagePct={usage?.pct}
            contextMax={contextMax}
            contextSegments={contextSegments}
          />
        </div>
      </div>
      {zoomImage && (
        <ImageLightbox
          src={zoomImage.src}
          name={zoomImage.name}
          onClose={() => setZoomImage(null)}
        />
      )}
    </>
  );
}
