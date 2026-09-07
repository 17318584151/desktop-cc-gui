import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import type { AiChatRepo, ThreadAction } from "@/components/application/ai-chat/ai-chat-sidebar";
import type { SessionMeta } from "@/lib/ipc";
import { pickDirectory } from "@/lib/platform";
import { useChatStore } from "./store";
import { relativeTime } from "./time";
import type { ChatPageDialog } from "./ChatPageDialogs";

/** Sidebar data and actions: the workspace/thread repo list plus thread
 * selection, pin/rename/delete dispatch, workspace add/remove/reorder, and
 * the new-chat entries. */
export function useChatSidebar({
  sessionById,
  threadStreaming,
  collapseSidebarOnMobile,
  composerInputRef,
  setDialog,
}: {
  sessionById: Map<string, SessionMeta>;
  threadStreaming: boolean[];
  collapseSidebarOnMobile: () => void;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
  setDialog: (dialog: ChatPageDialog) => void;
}) {
  const { t, i18n } = useTranslation();
  const { active, workspaces, sessions, threadLimit, unseen } = useChatStore(
    useShallow((s) => ({
      active: s.active,
      workspaces: s.workspaces,
      sessions: s.sessions,
      threadLimit: s.threadLimit,
      unseen: s.unseen,
    })),
  );
  // Store actions are stable references — one shallow subscription for all.
  const { selectSession, startNewChat, addWorkspace, reorderWorkspaces, pinSession } =
    useChatStore(
      useShallow((s) => ({
        selectSession: s.selectSession,
        startNewChat: s.startNewChat,
        addWorkspace: s.addWorkspace,
        reorderWorkspaces: s.reorderWorkspaces,
        pinSession: s.pinSession,
      })),
    );

  const repos: AiChatRepo[] = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    const streamingById = new Map<string, boolean>();
    sessions.forEach((s, i) => {
      if (threadStreaming[i]) streamingById.set(`${s.engine}/${s.sessionId}`, true);
    });
    return workspaces.map((w, index) => ({
      id: w.id,
      label: w.name,
      defaultOpen: index === 0,
      threadLimit,
      threads: sorted.flatMap((s) => {
        if (s.workspacePath !== w.path) return [];
        return [
          {
            id: `${s.engine}/${s.sessionId}`,
            label: s.customTitle || s.title || s.sessionId.slice(0, 8),
            engine: s.engine,
            time: relativeTime(s.updatedAt),
            pinned: s.pinned,
            streaming: streamingById.get(`${s.engine}/${s.sessionId}`) ?? false,
            unseen: unseen[`${s.engine}/${s.sessionId}`] ?? false,
          },
        ];
      }),
    }));
  }, [workspaces, sessions, threadLimit, threadStreaming, unseen, i18n.language]);

  const handleAddWorkspace = useCallback(() => {
    void pickDirectory(t("chat.addWorkspace"))
      .then((path) => {
        if (path) void addWorkspace(path);
      })
      .catch(() => {});
  }, [t, addWorkspace]);

  const handleThreadSelect = useCallback(
    (id: string) => {
      const session = sessionById.get(id);
      if (session) void selectSession(session.engine, session.sessionId, session.workspacePath);
      collapseSidebarOnMobile();
    },
    [sessionById, selectSession, collapseSidebarOnMobile],
  );

  const handleThreadAction = useCallback(
    (id: string, action: ThreadAction) => {
      const session = sessionById.get(id);
      if (!session) return;
      if (action === "pin") {
        void pinSession(session.engine, session.sessionId, !session.pinned);
      } else if (action === "rename") {
        setDialog({ kind: "rename", session });
      } else if (action === "delete") {
        setDialog({ kind: "delete", session });
      }
    },
    [sessionById, pinSession, setDialog],
  );
  const handleRemoveWorkspace = useCallback(
    (workspaceId: string) => {
      setDialog({ kind: "removeWorkspace", workspaceId });
    },
    [setDialog],
  );

  // Sidebar 新建会话 nav entry: new chat in the active workspace (fallback:
  // first workspace; no workspace yet → add one first).
  const handleNewSession = useCallback(() => {
    const workspace =
      workspaces.find((w) => w.path === active?.workspacePath) ?? workspaces[0];
    if (!workspace) {
      handleAddWorkspace();
      return;
    }
    startNewChat(workspace.path);
    composerInputRef.current?.focus();
    collapseSidebarOnMobile();
  }, [workspaces, active?.workspacePath, startNewChat, handleAddWorkspace, collapseSidebarOnMobile, composerInputRef]);

  // Workspace row + button: start (or re-focus) the pending new chat in that
  // workspace.
  const handleNewSessionInWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) return;
      startNewChat(workspace.path);
      composerInputRef.current?.focus();
      collapseSidebarOnMobile();
    },
    [workspaces, startNewChat, collapseSidebarOnMobile, composerInputRef],
  );
  const handleReorderWorkspaces = useCallback(
    (orderedIds: string[]) => void reorderWorkspaces(orderedIds),
    [reorderWorkspaces],
  );

  return {
    active,
    workspaces,
    startNewChat,
    repos,
    handleAddWorkspace,
    handleThreadSelect,
    handleThreadAction,
    handleRemoveWorkspace,
    handleNewSession,
    handleNewSessionInWorkspace,
    handleReorderWorkspaces,
  };
}
