import { useTranslation } from "react-i18next";
import FilePlus from "lucide-react/dist/esm/icons/file-plus";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import Copy from "lucide-react/dist/esm/icons/copy";
import ClipboardPaste from "lucide-react/dist/esm/icons/clipboard-paste";
import CopyPlus from "lucide-react/dist/esm/icons/copy-plus";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { parentPath } from "./store";

export interface FileTreeMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

/**
 * Right-click menu for file-tree rows. Positioning, dismissal and row
 * rendering come from the shared ContextMenu; this component only owns the
 * file-operation entry list.
 */
export function FileTreeContextMenu({
  menu,
  pasteDisabled,
  onClose,
  onNewFile,
  onNewFolder,
  onCopy,
  onPaste,
  onDuplicate,
  onRename,
  onCopyPath,
  onSendPath,
  onReveal,
  onTrash,
}: {
  menu: FileTreeMenuState;
  pasteDisabled: boolean;
  onClose: () => void;
  onNewFile: (parentDir: string) => void;
  onNewFolder: (parentDir: string) => void;
  onCopy: () => void;
  onPaste: (targetDir: string) => void;
  onDuplicate: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onSendPath: () => void;
  onReveal: () => void;
  onTrash: () => void;
}) {
  const { t } = useTranslation();

  const isMac = navigator.platform.includes("Mac");
  const isWindows = navigator.platform.includes("Win");
  const revealLabel = isMac
    ? t("files.revealInFinder")
    : isWindows
      ? t("files.revealInExplorer")
      : t("files.revealInFileManager");

  // New/paste targets: the folder itself for directory rows, the containing
  // folder for file rows.
  const targetDir = menu.isDir ? menu.path : parentPath(menu.path);

  const entries: (ContextMenuEntry | "separator")[] = [
    { id: "new-file", label: t("files.newFile"), icon: <FilePlus className="size-4" aria-hidden />, onSelect: () => onNewFile(targetDir) },
    { id: "new-folder", label: t("files.newFolder"), icon: <FolderPlus className="size-4" aria-hidden />, onSelect: () => onNewFolder(targetDir) },
    { id: "copy", label: t("files.copyItem"), icon: <Copy className="size-4" aria-hidden />, onSelect: onCopy },
    { id: "paste", label: t("files.pasteItem"), icon: <ClipboardPaste className="size-4" aria-hidden />, disabled: pasteDisabled, onSelect: () => onPaste(targetDir) },
    { id: "duplicate", label: t("files.duplicateItem"), icon: <CopyPlus className="size-4" aria-hidden />, onSelect: onDuplicate },
    { id: "rename", label: t("files.renameItem"), icon: <Pencil className="size-4" aria-hidden />, onSelect: onRename },
    { id: "copy-path", label: t("files.copyPath"), icon: <Link2 className="size-4" aria-hidden />, onSelect: onCopyPath },
    { id: "send-path", label: t("files.sendPathToComposer"), icon: <MessageSquarePlus className="size-4" aria-hidden />, onSelect: onSendPath },
    { id: "reveal", label: revealLabel, icon: <FolderOpen className="size-4" aria-hidden />, onSelect: onReveal },
    "separator",
    { id: "trash", label: t("files.deleteItem"), icon: <Trash2 className="size-4" aria-hidden />, danger: true, onSelect: onTrash },
  ];

  return (
    <ContextMenu x={menu.x} y={menu.y} ariaLabel={menu.path} entries={entries} onClose={onClose} />
  );
}
