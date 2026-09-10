import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  caretLeftPx,
  extractText,
  getCaretOffset,
} from "@/components/application/ai-chat/file-tags";
import { findSlashTrigger, useSlashCommandStore } from "@/components/application/ai-chat/slash-commands";
import { type SlashCommandMenuHandle } from "@/components/application/ai-chat/slash-command-menu";

/** Active `/query` trigger: start offset, query text, popover x anchor. */
export interface SlashTriggerState {
  start: number;
  query: string;
  left: number;
}

/** Popover width; shared by the caret clamp and the menu surface. */
export const SLASH_MENU_WIDTH = 420;

/**
 * useSlashPicker — state for the composer's `/` command picker, mirroring
 * useMentionPicker: an active trigger is a line-start `/` + query at the
 * caret (findSlashTrigger). The menu consumes arrows/Enter/Tab/Escape
 * through slashMenuRef; `left` anchors the popover to the caret's x
 * position and stays fixed while the query grows. Selecting an entry (DOM
 * mutation) stays in the composer — this hook only tracks the trigger.
 */
export function useSlashPicker({
  editableRef,
  wrapperRef,
  workspacePath,
  value,
  lastEmittedRef,
}: {
  editableRef: RefObject<HTMLDivElement | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  workspacePath?: string;
  /** Controlled field value: external changes invalidate a live trigger. */
  value?: string;
  /** Last text the composer emitted upward; own echoes skip the reset. */
  lastEmittedRef: MutableRefObject<string>;
}): {
  slash: SlashTriggerState | null;
  setSlash: Dispatch<SetStateAction<SlashTriggerState | null>>;
  slashMenuRef: MutableRefObject<SlashCommandMenuHandle | null>;
  /** Re-derive the trigger from the DOM; returns whether one is active so
   *  the composer can give `/` priority over the `@` mention picker. */
  updateSlashTrigger: () => boolean;
} {
  const slashMenuRef = useRef<SlashCommandMenuHandle | null>(null);
  const [slash, setSlash] = useState<SlashTriggerState | null>(null);

  // Workspace switch closes the picker: render-time adjustment via prev-prop
  // comparison instead of a cascading effect setState.
  const [prevWorkspacePath, setPrevWorkspacePath] = useState(workspacePath);
  if (prevWorkspacePath !== workspacePath) {
    setPrevWorkspacePath(workspacePath);
    setSlash(null);
  }

  // Prefetch the command catalog on workspace switch, so the first `/` is
  // instant.
  useEffect(() => {
    if (workspacePath) useSlashCommandStore.getState().ensure(workspacePath);
  }, [workspacePath]);

  // External value changes (draft restore on tab switch, clear on submit)
  // rebuild the editable DOM from text, which invalidates any live trigger
  // range — reset the picker via prev-prop comparison (render-time
  // adjustment, no cascading effect setState). Own emissions are already in
  // the DOM and skip this path through lastEmittedRef.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if ((value ?? "") !== lastEmittedRef.current) setSlash(null);
  }

  /** Caret x relative to the composer wrapper, clamped to the menu width. */
  const caretLeft = useCallback(
    () => caretLeftPx(wrapperRef.current, SLASH_MENU_WIDTH),
    [wrapperRef],
  );

  /** Re-derive the slash trigger from the DOM (called on real input only,
   *  never during IME composition). */
  const updateSlashTrigger = useCallback((): boolean => {
    const el = editableRef.current;
    if (!el || !workspacePath) return false;
    const caret = getCaretOffset(el);
    const trigger = caret >= 0 ? findSlashTrigger(extractText(el), caret) : null;
    setSlash((prev) => {
      if (!trigger) return null;
      if (prev && prev.start === trigger.start) return { ...prev, query: trigger.query };
      return { ...trigger, left: caretLeft() };
    });
    return trigger != null;
  }, [editableRef, workspacePath, caretLeft]);

  // Close the picker when the caret leaves the trigger (mouse click, arrow
  // keys). Typing keeps the same trigger start, so input stays open.
  useEffect(() => {
    if (!slash) return;
    const closeIfCaretLeft = () => {
      const el = editableRef.current;
      if (!el) return;
      const caret = getCaretOffset(el);
      const trigger = caret >= 0 ? findSlashTrigger(extractText(el), caret) : null;
      if (!trigger || trigger.start !== slash.start) setSlash(null);
    };
    document.addEventListener("selectionchange", closeIfCaretLeft);
    return () => document.removeEventListener("selectionchange", closeIfCaretLeft);
  }, [editableRef, slash]);

  return { slash, setSlash, slashMenuRef, updateSlashTrigger };
}
