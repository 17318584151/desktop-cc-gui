"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { getFileTreeIconSvg } from "@/features/files/fileIcons";
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEMS_CONTAINER,
  menuPopoverSurface,
} from "@/components/base/dropdown/menu-styles";
import { cx } from "@/utils/cx";
import {
  matchMentionEntries,
  useMentionIndexStore,
  type MentionEntry,
} from "./mention-files";

/**
 * @-mention file picker, rendered above the composer while a `@` trigger is
 * active. The contentEditable keeps focus and owns the keyboard; the menu is
 * deliberately NOT a react-aria popover (those steal focus / manage their
 * own trigger) — the composer forwards keys through `menuRef` instead.
 */

/** Imperative key handling for the composer's keydown handler. */
export interface FileMentionMenuHandle {
  /** Returns true when the menu consumed the key (caller preventDefaults). */
  handleKey: (key: string) => boolean;
}

const SURFACE = cx(
  menuPopoverSurface({ width: "w-[320px]", origin: "origin-bottom-left", padding: "p-1.5" }),
  "absolute bottom-full z-20 mb-2",
);

const Row = memo(function Row({
  entry,
  index,
  active,
  onSelect,
  onHover,
}: {
  entry: MentionEntry;
  index: number;
  active: boolean;
  onSelect: (entry: MentionEntry) => void;
  onHover: (index: number) => void;
}) {
  const icon = useMemo(
    () => getFileTreeIconSvg(entry.name, entry.isDir),
    [entry.name, entry.isDir],
  );
  // Parent path of the entry ("" for root-level), as the dim right column.
  const dir = entry.rel.slice(0, entry.rel.length - entry.name.length);
  return (
    <div
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      // Keyboard focus stays in the composer by design (keys are forwarded
      // through menuRef); tabIndex={-1} keeps the option programmatically
      // focusable without joining the tab order, and Enter/Space mirror the
      // click for any AT that does move focus here.
      tabIndex={-1}
      // Keep the contentEditable selection: the composer closes the menu when
      // the caret leaves the trigger, and focus must not move mid-click.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => {
        if (!active) onHover(index);
      }}
      onClick={() => onSelect(entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(entry);
        }
      }}
      className={cx(MENU_ITEM, active && MENU_ITEM_ACTIVE)}
    >
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center text-foreground-icon-secondary [&>svg]:size-4"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <span className="shrink-0 text-body-regular text-text-primary">{entry.name}</span>
      {dir && (
        <span className="truncate text-body-regular text-text-tertiary" title={entry.rel}>
          {dir}
        </span>
      )}
    </div>
  );
});

export function FileMentionMenu({
  root,
  query,
  /** Horizontal offset (px) of the `@` caret inside the composer wrapper. */
  left,
  onSelect,
  onClose,
  menuRef,
}: {
  root: string;
  query: string;
  left: number;
  onSelect: (entry: MentionEntry) => void;
  onClose: () => void;
  menuRef?: MutableRefObject<FileMentionMenuHandle | null>;
}) {
  const { t } = useTranslation();
  const index = useMentionIndexStore((s) => (root ? s.byRoot[root] : undefined));
  useEffect(() => {
    if (root) useMentionIndexStore.getState().ensure(root);
  }, [root]);

  const entries = index?.entries;
  const items = useMemo(
    () => matchMentionEntries(entries ?? [], root, query),
    [entries, root, query],
  );

  const [activeIndex, setActiveIndex] = useState(0);
  // New query/root → highlight the top match again: render-time adjustment
  // via prev-prop comparison instead of a cascading effect.
  const [prevScope, setPrevScope] = useState({ query, root });
  if (prevScope.query !== query || prevScope.root !== root) {
    setPrevScope({ query, root });
    setActiveIndex(0);
  }
  const active = items.length > 0 ? Math.min(activeIndex, items.length - 1) : -1;

  // Keep the highlighted row in view while arrowing.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  const handleKey = useCallback(
    (key: string): boolean => {
      switch (key) {
        case "ArrowDown":
        case "ArrowUp": {
          // Swallow even with no matches: the history nav must not hijack
          // arrows while the picker is open.
          if (items.length === 0) return true;
          const delta = key === "ArrowDown" ? 1 : -1;
          setActiveIndex((i) =>
            (Math.min(i, items.length - 1) + delta + items.length) % items.length,
          );
          return true;
        }
        case "Enter":
        case "Tab": {
          const item = active >= 0 ? items[active] : undefined;
          if (!item) return false; // fall through to send / ghost completion
          onSelect(item);
          return true;
        }
        case "Escape":
          onClose();
          return true;
        default:
          return false;
      }
    },
    [items, active, onSelect, onClose],
  );

  // Expose the key handle (same ref-prop pattern as ComposerInputHandle).
  useEffect(() => {
    if (!menuRef) return;
    const handle: FileMentionMenuHandle = { handleKey };
    menuRef.current = handle;
    return () => {
      if (menuRef.current === handle) menuRef.current = null;
    };
  }, [menuRef, handleKey]);

  const loading = index?.status === "loading" && items.length === 0;

  return (
    <div role="listbox" aria-label={t("chat.mentionFiles")} className={SURFACE} style={{ left }}>
      <div ref={listRef} className={cx(MENU_ITEMS_CONTAINER, "max-h-[300px] overflow-y-auto")}>
        {loading ? (
          <div className="p-2 text-body-regular text-text-tertiary select-none">
            {t("chat.mentionIndexing")}
          </div>
        ) : items.length === 0 ? (
          <div className="p-2 text-body-regular text-text-tertiary select-none">
            {t("chat.mentionNoMatches")}
          </div>
        ) : (
          items.map((entry, i) => (
            <Row
              key={entry.rel}
              entry={entry}
              index={i}
              active={i === active}
              onSelect={onSelect}
              onHover={setActiveIndex}
            />
          ))
        )}
      </div>
    </div>
  );
}
