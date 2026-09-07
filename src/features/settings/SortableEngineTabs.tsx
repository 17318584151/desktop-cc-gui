import { useCallback, useRef, useState } from "react";
import { Reorder } from "motion/react";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { cx } from "@/utils/cx";
import { readEngineOrder, writeEngineOrder, type EngineId } from "./providers";

/**
 * CLI 配置 engine switcher: pill tabs the user drags horizontally to
 * reorder. The whole pill is the handle — tabs are too small for a
 * dedicated grip — so a plain click must keep selecting. Built on motion's
 * Reorder like WorkspaceSortableList, sharing two of its conventions:
 *   - live preview: onReorder updates local order state while dragging;
 *     the commit (persisting to localStorage) happens on drag end;
 *   - click suppression: the click the browser fires after a drag gesture
 *     must not double as a tab select.
 * PillTabList's selection thumb measures layout offsets, so it tracks the
 * selected pill's slot (unaffected by the drag transform) throughout.
 */
export function SortableEngineTabs({
  engine,
  onSelect,
}: {
  engine: EngineId;
  onSelect: (engine: EngineId) => void;
}) {
  const [order, setOrder] = useState<EngineId[]>(readEngineOrder);
  const orderRef = useRef(order);
  /** Pill currently mid-drag; raised above siblings and grabs the cursor. */
  const [draggingId, setDraggingId] = useState<EngineId | null>(null);
  const suppressClickRef = useRef(false);

  const handleReorder = useCallback((next: EngineId[]) => {
    orderRef.current = next;
    setOrder(next);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    writeEngineOrder(orderRef.current);
    // Swallow the click fired after the gesture (see WorkspaceSortableList).
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  return (
    <PillTabList className="flex-wrap">
      <Reorder.Group
        as="div"
        axis="x"
        values={order}
        onReorder={handleReorder}
        className="flex flex-wrap items-center gap-1"
      >
        {order.map((id) => (
          <Reorder.Item
            key={id}
            as="div"
            value={id}
            onDragStart={() => {
              suppressClickRef.current = true;
              setDraggingId(id);
            }}
            onDragEnd={handleDragEnd}
            onClickCapture={(event) => {
              if (suppressClickRef.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            className={cx("shrink-0", draggingId === id && "relative z-20 cursor-grabbing")}
          >
            <PillTab
              variant="gray"
              isSelected={engine === id}
              onSelect={() => onSelect(id)}
              icon={({ className }) => (
                <EngineIcon engine={id} size={16} className={className} />
              )}
            >
              {CLI_DISPLAY_NAMES[id]}
            </PillTab>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </PillTabList>
  );
}
