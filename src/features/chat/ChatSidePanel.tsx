import { useTranslation } from "react-i18next";
import { ChangesPanel } from "@/features/git/ChangesPanel";
import { FilesPanel } from "@/features/files/FilesPanel";
import { cx } from "@/utils/cx";
import type { ActiveSession } from "./store";

/** Right-hand side panel: files/changes tabs with the full-height resize
 * strip on its left edge. Both panels stay mounted so tab switches preserve
 * tree expansion and scroll state. */
export function ChatSidePanel({
  active,
  panelRef,
  panelWidth,
  panelCollapsed,
  dragging,
  panelTab,
  onResizeStart,
}: {
  active: ActiveSession | null;
  panelRef: React.RefObject<HTMLDivElement>;
  panelWidth: number;
  panelCollapsed: boolean;
  dragging: "sidebar" | "panel" | null;
  panelTab: "files" | "changes";
  onResizeStart: (e: React.PointerEvent) => void;
}) {
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <div
      ref={panelRef}
      className={cx(
        "relative hidden shrink-0 overflow-hidden xl:flex",
        // Width transition for collapse/expand; disabled mid-drag
        // since resizes mutate style.width imperatively.
        !dragging &&
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
      )}
      style={{ width: panelCollapsed ? 0 : panelWidth }}
    >
      {/* Panel resize strip: full height, straddling the border. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resizePanel")}
        title={t("chat.resizePanel")}
        onPointerDown={onResizeStart}
        className={cx(
          "group absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none",
          panelCollapsed && "hidden",
        )}
      >
        <span
          className={cx(
            "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent-300 opacity-0 transition-opacity group-hover:opacity-100",
            dragging === "panel" && "opacity-100",
          )}
        />
      </div>
      <div
        className={cx(
          "flex h-full w-full flex-col overflow-hidden border-separator-border bg-background-primary-default",
          !panelCollapsed && "border-l",
        )}
      >
        {/* Both panels stay mounted so tab switches preserve tree
            expansion and scroll state. */}
        <div
          className={cx(
            "min-h-0 flex-1",
            panelTab === "files" ? "flex flex-col" : "hidden",
          )}
        >
          <FilesPanel workspacePath={active.workspacePath} />
        </div>
        <div
          className={cx(
            "min-h-0 flex-1",
            panelTab === "changes" ? "flex flex-col" : "hidden",
          )}
        >
          <ChangesPanel key={active.workspacePath} workspacePath={active.workspacePath} className="w-full" />
        </div>
      </div>
    </div>
  );
}
