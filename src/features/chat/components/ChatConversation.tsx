import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { mentionToken } from "@/components/application/ai-chat/file-tags";
import { AddMenu } from "@/components/application/ai-chat/add-menu";
import {
  PermissionMenu,
} from "@/components/application/ai-chat/permission-menu";
import { CliMenu, type EffortLevel } from "@/components/application/ai-chat/cli-menu";
import { effectivePermission, useChatStore, sessionKey, type ActiveSession, type QueuedMessage } from "../store";
import { recordPrompt } from "../prompt-history";
import { MessageTimeline } from "./MessageTimeline";
import { ConversationFooter } from "./ConversationFooter";
import { useBranchSwitcher } from "./use-branch-switcher";
import { useComposerImages } from "./use-composer-images";
import { useEngineModels } from "./use-engine-models";
import type { EngineInfo, Workspace } from "@/lib/ipc";
import { EmptyState } from "@/components/base/empty-state";

const EMPTY_QUEUE: QueuedMessage[] = [];

/** Assumed context window when the engine does not report one. */
const CONTEXT_WINDOW_TOKENS = 200_000;

/** Message list with its own bySession subscription: stream flushes swap the
 * messages array once per animation frame, and this boundary keeps that
 * high-frequency re-render from reaching the composer/status bar above. */
const SessionTimeline = memo(function SessionTimeline({
  sessionKey: key,
  workspacePath,
  onLoadEarlier,
}: {
  sessionKey: string;
  workspacePath: string;
  onLoadEarlier: () => void;
}) {
  const session = useChatStore((s) => s.bySession[key]);
  if (!session) return null;
  return (
    <MessageTimeline
      key={key}
      session={session}
      streaming={session.streaming}
      onLoadEarlier={onLoadEarlier}
      workspacePath={workspacePath}
    />
  );
});

/** Conversation column: timeline, message queue, composer, status bar. The
 * high-frequency session/draft subscriptions live here so streaming deltas
 * (one store write per animation frame) re-render only this subtree — never
 * the sidebar, tab strip, or side panel. */
export const ChatConversation = memo(function ChatConversation({
  active,
  engines,
  workspaces,
  startNewChat,
  composerInputRef,
}: {
  active: ActiveSession | null;
  engines: EngineInfo[];
  workspaces: Workspace[];
  startNewChat: (workspacePath: string) => void;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = active ? sessionKey(active.engine, active.sessionId, active.workspacePath) : "";
  // Key-scoped, LOW-frequency slices only: streaming flips at turn start/end,
  // queue/error/usage change on discrete actions. The per-flush messages
  // array is subscribed inside SessionTimeline so stream deltas re-render
  // only that subtree — never the composer, queue bar, or status bar here.
  const streaming = useChatStore((s) => (key ? (s.bySession[key]?.streaming ?? false) : false));
  const sessionError = useChatStore((s) => (key ? (s.bySession[key]?.error ?? null) : null));
  const dismissSessionError = useChatStore((s) => s.dismissSessionError);
  const queue = useChatStore((s) => (key ? (s.bySession[key]?.queue ?? EMPTY_QUEUE) : EMPTY_QUEUE));
  const sessionUsage = useChatStore((s) => (key ? s.bySession[key]?.usage : undefined));
  const hasSession = useChatStore((s) => key in s.bySession);
  const draft = useChatStore((s) => s.drafts[key] ?? "");
  const sendShortcut = useChatStore((s) => s.sendShortcut);
  const pendingMention = useChatStore((s) => s.pendingMention);
  // Engine/effort/model prefs: low-frequency, grouped into one shallow watch.
  const { activeEngine, efforts, models } = useChatStore(
    useShallow((s) => ({
      activeEngine: s.activeEngine,
      efforts: s.efforts,
      models: s.models,
    })),
  );
  const {
    setActiveEngine,
    setEffort,
    setModel,
    pinModels,
    setDraft,
    clearPendingMention,
    loadEarlier,
    send,
    queueMessage,
    removeQueued,
    clearQueue,
    interrupt,
  } = useChatStore(
    useShallow((s) => ({
      setActiveEngine: s.setActiveEngine,
      setEffort: s.setEffort,
      setModel: s.setModel,
      pinModels: s.pinModels,
      setDraft: s.setDraft,
      clearPendingMention: s.clearPendingMention,
      loadEarlier: s.loadEarlier,
      send: s.send,
      queueMessage: s.queueMessage,
      removeQueued: s.removeQueued,
      clearQueue: s.clearQueue,
      interrupt: s.interrupt,
    })),
  );
  const { branch, branches, branchError, handleBranchSelect, dismissBranchError } = useBranchSwitcher(active);
  // Permission mode lives in the store (persisted) and flows into every
  // send; engines that cannot honor the selected mode fall back to their
  // first supported one, which is what the chip displays.
  const permission = useChatStore((s) => s.permission);
  const setPermission = useChatStore((s) => s.setPermission);
  const { images, previews, imageError, removeImage, clearImages, pasteImages, dismissImageError } =
    useComposerImages();
  const { catalogs, modelsByEngine, refresh: refreshModels } = useEngineModels(engines, models, pinModels);

  // The catalog's context window beats the 200k assumption when the
  // selected model reports one.
  const contextMax =
    (catalogs[activeEngine]?.models ?? []).find((m) => m.id === models[activeEngine])
      ?.contextWindow || CONTEXT_WINDOW_TOKENS;

  const engineInfo = engines.find((e) => e.id === activeEngine);
  const supportsImages = engineInfo?.supportsImages ?? false;

  const handleLoadEarlier = useCallback(() => void loadEarlier(), [loadEarlier]);

  const submit = useCallback(
    (value: string) => {
      if (!active || (!value.trim() && images.length === 0)) return;
      recordPrompt(value);
      setDraft(key, "");
      clearImages();
      // A turn is in flight: park the message in the session's queue; the
      // store drains it FIFO when the turn ends.
      if (streaming) {
        queueMessage(value, images);
        return;
      }
      void send(value, images);
    },
    [active, images, streaming, key, setDraft, clearImages, send, queueMessage],
  );

  // File-tree "+" asks the composer to insert an @path mention at the caret.
  useEffect(() => {
    if (!pendingMention) return;
    clearPendingMention();
    const input = composerInputRef.current;
    if (!input) return;
    input.focus();
    input.insertText(`${mentionToken(pendingMention.path)} `);
  }, [pendingMention, clearPendingMention, composerInputRef]);

  const handleDraftChange = useCallback((v: string) => setDraft(key, v), [key, setDraft]);
  const handleStop = useCallback(() => void interrupt(), [interrupt]);
  // Disabled-in-settings CLIs leave the picker entirely; the greyed-out
  // state stays reserved for CLIs whose binary is not installed.
  const cliOptions = useMemo(
    () =>
      engines.flatMap((e) => {
        if (!e.enabled) return [];
        return [
          {
            id: e.id,
            label: t(`settings.engines.${e.id}`),
            available: e.available,
            disabled: !e.available,
            disabledReason: t("chat.engineNotInstalled"),
          },
        ];
      }),
    [engines, t],
  );
  // Every CLI is switched off in settings: swap the picker for a placeholder
  // that deep-links to the CLI config page.
  const noEnabledEngines = engines.length > 0 && cliOptions.length === 0;
  const handleModelChange = useCallback(
    (engine: string, m: string) => void setModel(engine, m),
    [setModel],
  );
  const handleEffortChange = useCallback(
    (engine: string, level: EffortLevel) => void setEffort(engine, level),
    [setEffort],
  );

  const addMenu = useMemo(
    () => (
      <AddMenu
        disabled={!supportsImages}
        disabledReason={t("chat.imagesUnsupported")}
      />
    ),
    [supportsImages, t],
  );
  const cliMenu = useMemo(
    () =>
      noEnabledEngines ? (
        <button
          type="button"
          onClick={() => navigate("/settings?page=cli:claude")}
          className="flex cursor-pointer items-center rounded-md px-1.5 py-1 text-body-2-medium whitespace-nowrap text-text-tertiary transition-colors duration-150 ease hover:text-text-primary"
        >
          {t("chat.noEngineEnabled")}
        </button>
      ) : (
        <CliMenu
          options={cliOptions}
          value={activeEngine}
          onChange={setActiveEngine}
          modelsByEngine={modelsByEngine}
          models={models}
          onModelChange={handleModelChange}
          efforts={efforts}
          onEffortChange={handleEffortChange}
          onRefreshModels={refreshModels}
        />
      ),
    [
      noEnabledEngines,
      navigate,
      t,
      cliOptions,
      activeEngine,
      setActiveEngine,
      modelsByEngine,
      models,
      handleModelChange,
      efforts,
      handleEffortChange,
      refreshModels,
    ],
  );
  const permissionMenu = useMemo(
    () => (
      <PermissionMenu
        value={effectivePermission(engines, activeEngine, permission)}
        onChange={setPermission}
        supported={engineInfo?.permissions}
      />
    ),
    [engines, activeEngine, permission, setPermission, engineInfo],
  );

  return (
    <>
      {active && hasSession ? (
        <>
          {sessionError && (
            <div
              role="alert"
              className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-border-error-default bg-background-tertiary-error px-3 py-2 text-body-regular text-text-error-primary"
            >
              <span className="min-w-0 flex-1 break-all">{sessionError}</span>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => dismissSessionError(key)}
                className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background-tertiary-hover"
              >
                ×
              </button>
            </div>
          )}
          <SessionTimeline
            sessionKey={key}
            workspacePath={active.workspacePath}
            onLoadEarlier={handleLoadEarlier}
          />
        </>
      ) : (
        <EmptyState className="text-body-medium">{t("chat.selectSession")}</EmptyState>
      )}

      <ConversationFooter
        active={active}
        workspaces={workspaces}
        queue={queue}
        onRemoveQueued={removeQueued}
        onClearQueued={clearQueue}
        imageError={imageError}
        branchError={branchError}
        onDismissImageError={dismissImageError}
        onDismissBranchError={dismissBranchError}
        images={images}
        previews={previews}
        onRemoveImage={removeImage}
        draft={draft}
        onDraftChange={handleDraftChange}
        onSubmit={submit}
        sendShortcut={sendShortcut}
        onStop={handleStop}
        streaming={streaming}
        noEnabledEngines={noEnabledEngines}
        composerInputRef={composerInputRef}
        addMenu={addMenu}
        cliMenu={cliMenu}
        permissionMenu={permissionMenu}
        supportsImages={supportsImages}
        onPasteImages={pasteImages}
        sessionUsage={sessionUsage}
        contextMax={contextMax}
        branch={branch}
        branches={branches}
        onBranchSelect={handleBranchSelect}
        startNewChat={startNewChat}
      />
    </>
  );
});
