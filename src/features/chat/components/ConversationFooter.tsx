import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { ImageLightbox } from "./MessageImages";
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
  const statusFolders = useMemo(() => workspaces.map((w) => baseName(w.path)), [workspaces]);
  const handleFolderSelect = useCallback(
    (name: string) => {
      const target = workspaces.find((w) => baseName(w.path) === name);
      if (target) startNewChat(target.path);
    },
    [workspaces, startNewChat],
  );

  return (
    <>
      <div className="flex w-full flex-col gap-2.5 bg-background-primary-default px-4 pt-2.5 pb-2">
        <MessageQueue queue={queue} onRemove={onRemoveQueued} onClear={onClearQueued} className="mx-auto w-full max-w-3xl" />
        {imageError && (
          <div className="rounded-lg border border-border-error-default bg-background-tertiary-error px-3 py-2 text-body-regular text-text-error-primary">
            {imageError}
          </div>
        )}
        {branchError && (
          <div className="rounded-lg border border-border-error-default bg-background-tertiary-error px-3 py-2 text-body-regular text-text-error-primary">
            {branchError}
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
          addMenu={addMenu}
          cliMenu={cliMenu}
          permissionMenu={permissionMenu}
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
