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
  extractText,
  findMentionTrigger,
  getCaretOffset,
} from "@/components/application/ai-chat/file-tags";
import { type FileMentionMenuHandle } from "@/components/application/ai-chat/file-mention-menu";
import { useMentionIndexStore } from "@/components/application/ai-chat/mention-files";

/** Active `@query` trigger: start offset, query text, popover x anchor. */
export interface MentionTriggerState {
  start: number;
  query: string;
  left: number;
}

/**
 * useMentionPicker — state for the composer's `@` file-mention picker: an
 * active trigger is `@` + query at the caret (findMentionTrigger). The menu
 * consumes arrows/Enter/Tab/Escape through mentionMenuRef; `left` anchors
 * the popover to the caret's x position and stays fixed while the query
 * grows. Selecting an entry (DOM mutation) stays in the composer — this hook
 * only tracks the trigger.
 */
export function useMentionPicker({
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
  mention: MentionTriggerState | null;
  setMention: Dispatch<SetStateAction<MentionTriggerState | null>>;
  mentionMenuRef: MutableRefObject<FileMentionMenuHandle | null>;
  updateMentionTrigger: () => void;
} {
  const mentionMenuRef = useRef<FileMentionMenuHandle | null>(null);
  const [mention, setMention] = useState<MentionTriggerState | null>(null);

  // Workspace switch closes the picker: render-time adjustment via prev-prop
  // comparison instead of a cascading effect setState.
  const [prevWorkspacePath, setPrevWorkspacePath] = useState(workspacePath);
  if (prevWorkspacePath !== workspacePath) {
    setPrevWorkspacePath(workspacePath);
    setMention(null);
  }

  // Prefetch the file index on workspace switch, so the first `@` is instant.
  useEffect(() => {
    if (workspacePath) useMentionIndexStore.getState().ensure(workspacePath);
  }, [workspacePath]);

  // External value changes (draft restore on tab switch, clear on submit)
  // rebuild the editable DOM from text, which invalidates any live trigger
  // range — reset the picker via prev-prop comparison (render-time
  // adjustment, no cascading effect setState). Own emissions are already in
  // the DOM and skip this path through lastEmittedRef.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if ((value ?? "") !== lastEmittedRef.current) setMention(null);
  }

  /** Caret x relative to the composer wrapper, clamped to the menu width. */
  const caretLeftPx = useCallback(() => {
    const wrapper = wrapperRef.current;
    const selection = window.getSelection();
    if (!wrapper || !selection || selection.rangeCount === 0) return 0;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const wrap = wrapper.getBoundingClientRect();
    // A collapsed range in an element container (right after a chip) reports
    // a zero rect in WKWebView — fall back to the wrapper's left edge.
    const raw = (rect.left || wrap.left) - wrap.left;
    return Math.max(0, Math.min(raw, Math.max(0, wrap.width - 320)));
  }, [wrapperRef]);

  /** Re-derive the mention trigger from the DOM (called on real input only,
   *  never during IME composition). */
  const updateMentionTrigger = useCallback(() => {
    const el = editableRef.current;
    if (!el || !workspacePath) return;
    const caret = getCaretOffset(el);
    const trigger = caret >= 0 ? findMentionTrigger(extractText(el), caret) : null;
    setMention((prev) => {
      if (!trigger) return null;
      if (prev && prev.start === trigger.start) return { ...prev, query: trigger.query };
      return { ...trigger, left: caretLeftPx() };
    });
  }, [editableRef, workspacePath, caretLeftPx]);

  // Close the picker when the caret leaves the trigger (mouse click, arrow
  // keys). Typing keeps the same trigger start, so input stays open.
  useEffect(() => {
    if (!mention) return;
    const closeIfCaretLeft = () => {
      const el = editableRef.current;
      if (!el) return;
      const caret = getCaretOffset(el);
      const trigger = caret >= 0 ? findMentionTrigger(extractText(el), caret) : null;
      if (!trigger || trigger.start !== mention.start) setMention(null);
    };
    document.addEventListener("selectionchange", closeIfCaretLeft);
    return () => document.removeEventListener("selectionchange", closeIfCaretLeft);
  }, [editableRef, mention]);

  return { mention, setMention, mentionMenuRef, updateMentionTrigger };
}
