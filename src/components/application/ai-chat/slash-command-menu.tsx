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
import Terminal from "lucide-react/dist/esm/icons/terminal";
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEMS_CONTAINER,
  menuPopoverSurface,
} from "@/components/base/dropdown/menu-styles";
import { cx } from "@/utils/cx";
import {
  matchSlashCommands,
  useSlashCommandStore,
} from "./slash-commands";
import { type SlashCommandEntry } from "@/lib/ipc";

/**
 * `/` slash-command picker, rendered above the composer while a `/` trigger
 * is active. Same interaction model as FileMentionMenu: the contentEditable
 * keeps focus and owns the keyboard; the menu is deliberately NOT a
 * react-aria popover (those steal focus / manage their own trigger) — the
 * composer forwards keys through `menuRef` instead.
 */

/** Imperative key handling for the composer's keydown handler. */
export interface SlashCommandMenuHandle {
  /** Returns true when the menu consumed the key (caller preventDefaults). */
  handleKey: (key: string) => boolean;
}

// Literal width class: Tailwind's scanner never sees template interpolation.
const SURFACE = cx(
  menuPopoverSurface({ width: "w-[420px]", origin: "origin-bottom-left", padding: "p-1.5" }),
  "absolute bottom-full z-20 mb-2",
);

const Row = memo(function Row({
  entry,
  index,
  active,
  onSelect,
  onHover,
}: {
  entry: SlashCommandEntry;
  index: number;
  active: boolean;
  onSelect: (entry: SlashCommandEntry) => void;
  onHover: (index: number) => void;
}) {
  const description = entry.description ?? "";
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
      <Terminal
        aria-hidden
        className="size-4 shrink-0 text-foreground-icon-secondary"
      />
      <span className="shrink-0 font-mono text-body-regular text-text-primary">
        /{entry.name}
      </span>
      {description && (
        <span className="truncate text-body-regular text-text-tertiary" title={description}>
          {description}
        </span>
      )}
    </div>
  );
});

export function SlashCommandMenu({
  root,
  query,
  /** Horizontal offset (px) of the `/` caret inside the composer wrapper. */
  left,
  onSelect,
  onClose,
  menuRef,
}: {
  root: string;
  query: string;
  left: number;
  onSelect: (entry: SlashCommandEntry) => void;
  onClose: () => void;
  menuRef?: MutableRefObject<SlashCommandMenuHandle | null>;
}) {
  const { t } = useTranslation();
  const catalog = useSlashCommandStore((s) => (root ? s.byRoot[root] : undefined));
  useEffect(() => {
    if (root) useSlashCommandStore.getState().ensure(root);
  }, [root]);

  const entries = catalog?.entries;
  const items = useMemo(
    () => matchSlashCommands(entries ?? [], query),
    [entries, query],
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
    const handle: SlashCommandMenuHandle = { handleKey };
    menuRef.current = handle;
    return () => {
      if (menuRef.current === handle) menuRef.current = null;
    };
  }, [menuRef, handleKey]);

  const loading = catalog?.status === "loading" && items.length === 0;

  return (
    <div role="listbox" aria-label={t("chat.slashCommands")} className={SURFACE} style={{ left }}>
      <div ref={listRef} className={cx(MENU_ITEMS_CONTAINER, "max-h-[300px] overflow-y-auto")}>
        {loading ? (
          <div className="p-2 text-body-regular text-text-tertiary select-none">
            {t("chat.slashLoading")}
          </div>
        ) : items.length === 0 ? (
          <div className="p-2 text-body-regular text-text-tertiary select-none">
            {t("chat.slashNoMatches")}
          </div>
        ) : (
          items.map((entry, i) => (
            <Row
              key={`${entry.source}:${entry.name}`}
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
