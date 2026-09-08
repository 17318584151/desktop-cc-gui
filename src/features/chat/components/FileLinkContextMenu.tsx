import { useTranslation } from "react-i18next";
import FileText from "lucide-react/dist/esm/icons/file-text";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { ipc } from "@/lib/ipc";
import { useFilesStore } from "@/features/files/store";
import {
  OPEN_APP_ICONS,
  OPEN_APP_TARGETS,
  openPathInTarget,
  readSelectedOpenAppId,
} from "@/features/open-app/open-app";

export interface FileLinkMenuState {
  x: number;
  y: number;
  /** Path as written in the message (may be workspace-relative). */
  path: string;
  /** Absolute path, or null when unresolvable (`~/`, `../`, empty). */
  resolvedPath: string | null;
}

/**
 * Right-click menu for chat file links (the green dotted-underline paths in
 * markdown). Chrome (portal anchoring, viewport clamping, Escape/outside
 * dismissal) comes from the shared ContextMenu; this component only owns the
 * file-link entry list:
 *
 * - 打开文件 → center-area editor tab (same as left-click)
 * - 在 <app> 中打开 → the header's selected "open with" target (VS Code,
 *   Cursor, IDEA); when that target is the file manager this entry *is* the
 *   reveal action, matching the reference app
 * - 在访达/资源管理器中显示 → OS file manager
 * - 复制链接 → file:// URL for absolute paths, raw path otherwise
 *
 * Failures are silent (console only), mirroring HeaderOpenActions: a missing
 * editor binary isn't worth an error surface in the chat timeline.
 */
export function FileLinkContextMenu({
  menu,
  onClose,
}: {
  menu: FileLinkMenuState;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const target =
    OPEN_APP_TARGETS.find((candidate) => candidate.id === readSelectedOpenAppId()) ??
    OPEN_APP_TARGETS[0];

  const isMac = navigator.platform.includes("Mac");
  const isWindows = navigator.platform.includes("Win");
  const revealLabel = isMac
    ? t("files.revealInFinder")
    : isWindows
      ? t("files.revealInExplorer")
      : t("files.revealInFileManager");

  const resolved = menu.resolvedPath;
  const revealEntry: ContextMenuEntry = {
    id: "reveal",
    label: revealLabel,
    icon: <FolderOpen className="size-4" aria-hidden />,
    disabled: !resolved,
    onSelect: () => {
      if (resolved) void ipc.revealInFileManager(resolved).catch(() => {});
    },
  };

  const entries: ContextMenuEntry[] = [
    {
      id: "open-file",
      label: t("files.openFile"),
      icon: <FileText className="size-4" aria-hidden />,
      disabled: !resolved,
      onSelect: () => {
        if (resolved) void useFilesStore.getState().openFile(resolved);
      },
    },
    target.kind === "finder"
      ? revealEntry
      : {
          id: "open-in-app",
          label: t("files.openInApp", { app: target.label }),
          icon: <img src={OPEN_APP_ICONS[target.id]} alt="" className="size-4 rounded-[3px]" />,
          disabled: !resolved,
          onSelect: () => {
            if (resolved) void openPathInTarget(resolved, target).catch(() => {});
          },
        },
    ...(target.kind === "finder" ? [] : [revealEntry]),
    {
      id: "copy-link",
      label: t("files.copyLink"),
      icon: <Link2 className="size-4" aria-hidden />,
      onSelect: () => {
        const link = resolved?.startsWith("/") ? `file://${resolved}` : (resolved ?? menu.path);
        void navigator.clipboard.writeText(link).catch(() => {});
      },
    },
  ];

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={menu.path}
      entries={entries}
      onClose={onClose}
    />
  );
}
