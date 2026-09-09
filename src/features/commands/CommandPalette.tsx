import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Search from "lucide-react/dist/esm/icons/search";
import { cx } from "@/utils/cx";
import { commandRegistry, useRegistry } from "@ccgui/plugin-sdk";
import type { CommandDef } from "@ccgui/plugin-sdk";
// Side-effect import: registers the builtin commands into commandRegistry.
import "./builtins";

/**
 * Command palette (plan §4.2 #9). ⌘K / Ctrl+K toggles it from anywhere
 * (window-level keydown, so it works in the web build and the desktop shell);
 * Esc or a backdrop click closes it.
 *
 * The palette is a pure projection of commandRegistry — builtin commands
 * (./builtins) and plugin commands (ctx.ui.registerCommand) share the one
 * data source, so a plugin command appears the moment it is registered.
 * Matching is a case-insensitive substring test over title() + keywords();
 * both are thunks resolved at render time so a language flip re-titles rows.
 */

interface CommandMatch {
  def: CommandDef;
  title: string;
  keywords: string[];
}

export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const commands = useRegistry(commandRegistry);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K toggles the palette (same global-keydown pattern as the
  // ⌘J terminal toggle in ChatPage).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fresh query + focus every time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, [open]);

  const matches = useMemo<CommandMatch[]>(() => {
    const resolved = commands.map((def) => ({
      def,
      title: def.title(),
      keywords: def.keywords?.() ?? [],
    }));
    const q = query.trim().toLowerCase();
    if (!q) return resolved;
    return resolved.filter(
      ({ title, keywords }) =>
        title.toLowerCase().includes(q) ||
        keywords.some((keyword) => keyword.toLowerCase().includes(q)),
    );
    // Titles/keywords are i18n thunks — re-resolve on language flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, query, i18n.language]);

  // The filtered list can shrink under the cursor; clamp the active row.
  const active = Math.min(activeIndex, Math.max(0, matches.length - 1));

  const runCommand = (def: CommandDef) => {
    try {
      def.run();
    } catch (error) {
      // A broken command must never take the palette down with it.
      console.error(`[commands] "${def.id}" failed`, error);
      return;
    }
    setOpen(false);
  };

  // Keyboard navigation lives on window too: Esc/↑/↓/Enter work regardless
  // of which element inside the palette currently holds focus.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const match = matches[Math.min(activeIndex, Math.max(0, matches.length - 1))];
        if (match) runCommand(match.def);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matches, activeIndex]);

  // Keep the keyboard-highlighted row visible while arrowing through a
  // scrolled list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-110 flex items-start justify-center bg-overlay-backdrop px-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label={t("commands.paletteTitle")}
        className="w-[560px] max-w-full overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-separator-border px-3">
          <Search className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("commands.placeholder")}
            aria-label={t("commands.placeholder")}
            className="h-11 w-full bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
          />
        </div>
        <div ref={listRef} role="listbox" className="max-h-[320px] overflow-y-auto p-2">
          {matches.length === 0 ? (
            <div className="px-2 py-6 text-center text-body-medium text-text-secondary">
              {t("commands.empty")}
            </div>
          ) : (
            matches.map((match, index) => (
              <button
                key={match.def.id}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(match.def)}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-left outline-none transition-colors",
                  index === active && "bg-dropdown-item-hover-background",
                )}
              >
                <span className="truncate text-body-medium text-text-primary">{match.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
