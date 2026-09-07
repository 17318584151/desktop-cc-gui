import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  extractText,
  insertTextAtCaret,
} from "@/components/application/ai-chat/file-tags";
import { type FileMentionMenuHandle } from "@/components/application/ai-chat/file-mention-menu";
import { cx } from "@/utils/cx";

/**
 * ComposerEditable — the composer's contentEditable field and its event
 * wiring: IME composition gating (WKWebView fires `compositionend` BEFORE
 * the Enter keydown that commits the candidate, so Enter is gated on a sync
 * ref plus a 100ms "recently settled" window), mention-picker key
 * delegation, ghost-text Tab accept, ArrowUp/ArrowDown history recall, the
 * configured send gesture, and image/plain-text paste. All state lives in
 * the composer and arrives as props.
 */
export function ComposerEditable({
  editableRef,
  sendShortcut,
  mentionOpen,
  completionSuffix,
  acceptCompletion,
  setEditableText,
  handleHistoryKeyDown,
  mentionMenuRef,
  isComposingRef,
  lastCompositionEndTimeRef,
  setIsComposing,
  emitChange,
  syncTags,
  updateMentionTrigger,
  disabled,
  onSubmit,
  onPasteImages,
  manualHeightPx,
}: {
  editableRef: RefObject<HTMLDivElement>;
  sendShortcut: "enter" | "cmdEnter";
  /** A mention trigger is active: gates the ghost completion + key delegation. */
  mentionOpen: boolean;
  /** Ghost-text history suffix painted after the caret ("" = none). */
  completionSuffix: string;
  /** Accept the ghost suggestion: returns the full text, or null. */
  acceptCompletion: () => string | null;
  setEditableText: (text: string) => void;
  handleHistoryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  mentionMenuRef: MutableRefObject<FileMentionMenuHandle | null>;
  isComposingRef: MutableRefObject<boolean>;
  lastCompositionEndTimeRef: MutableRefObject<number>;
  setIsComposing: (composing: boolean) => void;
  emitChange: () => void;
  syncTags: () => void;
  updateMentionTrigger: () => void;
  disabled: boolean;
  onSubmit?: (value: string) => void;
  onPasteImages?: (files: File[]) => void;
  /** Explicit editable-area height; null = auto-grow layout. */
  manualHeightPx: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div
      ref={editableRef}
      contentEditable
      role="textbox"
      aria-multiline="true"
      aria-label={t("chat.send")}
      data-placeholder={sendShortcut === "cmdEnter" ? t("chat.inputPlaceholderCmdEnter") : t("chat.inputPlaceholder")}
      data-completion-suffix={mentionOpen ? undefined : completionSuffix || undefined}
      onInput={() => {
        emitChange();
        syncTags();
        if (!isComposingRef.current) updateMentionTrigger();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
        setIsComposing(true);
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        setIsComposing(false);
        lastCompositionEndTimeRef.current = Date.now();
        // Composition commits text without an input event in WKWebView.
        emitChange();
        syncTags();
        updateMentionTrigger();
      }}
      onKeyDown={(event) => {
        // An open mention picker owns arrows/Enter/Tab/Escape (never
        // mid-IME: those keys belong to the candidate window).
        if (
          mentionOpen &&
          !event.nativeEvent.isComposing &&
          !isComposingRef.current &&
          event.nativeEvent.keyCode !== 229 &&
          mentionMenuRef.current?.handleKey(event.key)
        ) {
          event.preventDefault();
          return;
        }
        // Tab accepts the ghost-text history completion (never mid-IME).
        if (
          event.key === "Tab" &&
          completionSuffix &&
          !event.nativeEvent.isComposing &&
          !isComposingRef.current &&
          event.nativeEvent.keyCode !== 229
        ) {
          event.preventDefault();
          const full = acceptCompletion();
          if (full !== null) setEditableText(full);
          return;
        }
        // ArrowUp/ArrowDown recall submitted prompts from history.
        if (handleHistoryKeyDown(event)) return;
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        // "cmdEnter": only ⌘/Ctrl+Enter sends; bare Enter falls through to
        // the contentEditable default and inserts a newline.
        const meta = event.metaKey || event.ctrlKey;
        if (sendShortcut === "cmdEnter" ? !meta : event.shiftKey) return;
        if (isComposingRef.current) return;
        if (event.nativeEvent.keyCode === 229) return;
        // Swallow the Enter that only committed the IME candidate.
        if (Date.now() - lastCompositionEndTimeRef.current < 100) return;
        event.preventDefault();
        // Fires while streaming too: the host queues the message behind the
        // active turn instead of dropping it.
        const el = editableRef.current;
        if (!disabled && el) onSubmit?.(extractText(el));
      }}
      onPaste={(event) => {
        const files: File[] = [];
        for (const item of Array.from(event.clipboardData?.items ?? [])) {
          if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
        if (files.length > 0 && onPasteImages) {
          // Image payload: the host turns the files into attachments.
          event.preventDefault();
          onPasteImages(files);
          return;
        }
        // Plain text only: clipboard HTML must not leak markup (spans,
        // styles) into the editable — chips are the only allowed markup.
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const el = editableRef.current;
        if (!text || !el) return;
        insertTextAtCaret(el, text);
        emitChange();
        syncTags();
      }}
      style={manualHeightPx != null ? { height: manualHeightPx } : undefined}
      className={cx(
        "composer-editable w-full overflow-y-auto bg-transparent px-1.5 py-1 text-body-regular text-text-primary caret-accent-500 outline-none",
        manualHeightPx == null && "max-h-40 min-h-[52px]",
      )}
    />
  );
}
