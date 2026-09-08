import { useTranslation } from "react-i18next";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { HeaderOpenActions } from "@/features/open-app/HeaderOpenActions";
import { cx } from "@/utils/cx";
import { PANEL_TOGGLE_CLASSES } from "./panel-toggle-classes";

/** Tab-strip actions slot: the open-in-app cluster plus the side panel's
 * titlebar header (files/changes pills and collapse toggles). */
export function ChatPanelHeader({
  workspacePath,
  panelTab,
  onPanelTabChange,
  panelCollapsed,
  onTogglePanelCollapsed,
  panelWidth,
  panelHeaderRef,
  dragging,
}: {
  workspacePath: string;
  panelTab: "files" | "changes";
  onPanelTabChange: (tab: "files" | "changes") => void;
  panelCollapsed: boolean;
  onTogglePanelCollapsed: () => void;
  panelWidth: number;
  panelHeaderRef: React.RefObject<HTMLDivElement>;
  dragging: "sidebar" | "panel" | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center">
      <HeaderOpenActions workspacePath={workspacePath} />
      <div className="hidden h-full items-center xl:flex">
        {
          // Panel header lives in the titlebar: same width as the
          // panel below, border-l continuing the panel's left edge.
          // Always mounted so width animates in sync with the panel;
          // stays put in changes mode so its pills remain reachable.
          <div
            ref={panelHeaderRef}
            className={cx(
              "flex h-full items-center justify-end overflow-hidden",
              // Width is mutated imperatively during panel drags.
              !dragging &&
                "transition-[width] duration-200 ease-out motion-reduce:transition-none",
              !panelCollapsed && "border-l border-separator-border",
            )}
            style={{ width: panelCollapsed ? 0 : panelWidth }}
          >
            <div
              className="flex h-full shrink-0 items-center gap-2 px-3"
              style={{ width: panelWidth }}
            >
              <PillTabList>
                <PillTab
                  icon={FolderSymlink}
                  isSelected={panelTab === "files"}
                  onSelect={() => onPanelTabChange("files")}
                >
                  {t("files.tab")}
                </PillTab>
                <PillTab
                  icon={GitBranch}
                  isSelected={panelTab === "changes"}
                  onSelect={() => onPanelTabChange("changes")}
                >
                  {t("git.changes")}
                </PillTab>
              </PillTabList>
              <button
                type="button"
                title={t("openApp.collapsePanel")}
                aria-label={t("openApp.collapsePanel")}
                onClick={onTogglePanelCollapsed}
                className={cx(PANEL_TOGGLE_CLASSES, "ml-auto")}
              >
                <PanelRightClose className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        }
        {panelCollapsed && (
          <button
            type="button"
            title={t("openApp.expandPanel")}
            aria-label={t("openApp.expandPanel")}
            onClick={onTogglePanelCollapsed}
            className={cx(PANEL_TOGGLE_CLASSES, "mx-1.5")}
          >
            <PanelRightOpen className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
