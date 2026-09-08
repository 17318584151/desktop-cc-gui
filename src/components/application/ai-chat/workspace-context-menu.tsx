import { useTranslation } from "react-i18next";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";

export interface WorkspaceMenuState {
  x: number;
  y: number;
  workspaceId: string;
}

/**
 * Right-click menu for sidebar workspace rows. Chrome (portal anchoring,
 * viewport clamping, Escape/outside dismissal) comes from the shared
 * ContextMenu; this component only owns the workspace action entries.
 */
export function WorkspaceContextMenu({
  menu,
  onClose,
  onSetAlias,
}: {
  menu: WorkspaceMenuState;
  onClose: () => void;
  onSetAlias: (workspaceId: string) => void;
}) {
  const { t } = useTranslation();

  const entries: ContextMenuEntry[] = [
    {
      id: "set-alias",
      label: t("chat.setWorkspaceAlias"),
      icon: <Pencil className="size-4" aria-hidden />,
      onSelect: () => onSetAlias(menu.workspaceId),
    },
  ];

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={menu.workspaceId}
      entries={entries}
      onClose={onClose}
    />
  );
}
