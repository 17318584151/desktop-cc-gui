"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up";
import GitMerge from "lucide-react/dist/esm/icons/git-merge";
import CircleStop from "lucide-react/dist/esm/icons/circle-stop";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import {
  AgentLimitsCard,
  type ContextSegment,
  type UsageLimit,
} from "@/components/application/agent-limits/agent-limits-card";
import { ProjectFolderMenu } from "@/components/application/ai-chat/project-folder-menu";
import {
  BranchMenu,
  type BranchMenuItem,
} from "@/components/application/ai-chat/branch-menu";
import { ComposerResizeHandle } from "@/components/application/ai-chat/composer-resize-handle";
import { useResizableComposer } from "@/components/application/ai-chat/use-resizable-composer";
import {
  FILE_TAG_CLASS,
  extractText,
  findMentionTrigger,
  getCaretOffset,
  htmlFromText,
  insertTextAtCaret,
  mentionToken,
  renderFileTags,
  setCaretOffset,
} from "@/components/application/ai-chat/file-tags";
import {
  FileMentionMenu,
  type FileMentionMenuHandle,
} from "@/components/application/ai-chat/file-mention-menu";
import {
  useMentionIndexStore,
  type MentionEntry,
} from "@/components/application/ai-chat/mention-files";
import { joinPath } from "@/features/files/store";
import {
  usePromptCompletion,
  usePromptHistoryNav,
} from "@/components/application/ai-chat/use-prompt-history";
import { cx } from "@/utils/cx";
import { useDismissOnOutsidePress, useTriggerToggle } from "@/utils/use-dismiss-on-outside-press";

/**
 * Board UI → "ai_chat" composer + status bar, adapted to live data. The pill
 * keeps the template visual (add menu, model menu, send control); the field
 * is a textarea so Shift+Enter inserts a newline; while a turn streams the
 * send button becomes a stop control. The status bar renders real branch /
 * workspace / token usage.
 */

/** Imperative handle on the composer's editable field. */
export interface ComposerInputHandle {
  focus: () => void;
  /** Insert plain text at the caret; `@/abs/path` mentions render as chips. */
  insertText: (text: string) => void;
}

export interface ComposerProps {
  className?: string;
  /** Controlled field value. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Fires on the send button and on the configured send gesture (sendShortcut). */
  onSubmit?: (value: string) => void;
  /** Send gesture: "enter" = Enter sends, Shift+Enter newline (default);
   *  "cmdEnter" = ⌘/Ctrl+Enter sends, plain Enter newline. */
  sendShortcut?: "enter" | "cmdEnter";
  /** Fires on the stop button while streaming. */
  onStop?: () => void;
  /** A turn is in flight: send becomes stop. */
  streaming?: boolean;
  /** Greys out send. */
  disabled?: boolean;
  /** Slot for the add-attachment menu (template AddMenu). */
  addMenu?: ReactNode;
  /** Slot for the CLI + model switcher (CliMenu). */
  cliMenu?: ReactNode;
  /** Slot for the permission-mode picker (PermissionMenu). */
  permissionMenu?: ReactNode;
  /** The field itself, for focus management and mention insertion. */
  inputRef?: MutableRefObject<ComposerInputHandle | null>;
  /** Clipboard images pasted into the field; absent = paste stays text-only. */
  onPasteImages?: (files: File[]) => void;
  /** Active workspace root: enables the `@` file-mention picker. */
  workspacePath?: string;
}

export function Composer({
  className,
  value,
  onValueChange,
  onSubmit,
  sendShortcut = "enter",
  onStop,
  streaming = false,
  disabled = false,
  addMenu,
  cliMenu,
  permissionMenu,
  inputRef,
  onPasteImages,
  workspacePath,
}: ComposerProps = {}) {
  const { t } = useTranslation();
  const editableRef = useRef<HTMLDivElement>(null);
  // IME composition tracking (desktop-cc-gui parity): WKWebView fires
  // `compositionend` BEFORE the Enter keydown that commits the candidate, so
  // `nativeEvent.isComposing` is already false at that keydown and the plain
  // check would send the message. Gate Enter on a sync ref plus a 100ms
  // "recently settled" window after compositionend.
  const isComposingRef = useRef(false);
  const lastCompositionEndTimeRef = useRef(0);
  // Reactive mirror of isComposingRef: gates the ghost completion so IME
  // candidates never produce a suggestion.
  const [isComposing, setIsComposing] = useState(false);

  // Top-edge drag resize (desktop-cc-gui parity): the handle fixes the field
  // at an explicit height; without a manual size the field keeps auto-growing.
  const { isResizing, isCollapsed, manualHeightPx, getHandleProps, nudge } =
    useResizableComposer({ editableRef });

  /** Last text we emitted upward; the value-sync effect skips our own echoes. */
  const lastEmittedRef = useRef("");

  // @-mention file picker: an active trigger is `@` + query at the caret
  // (findMentionTrigger). The menu consumes arrows/Enter/Tab/Escape through
  // mentionMenuRef; `left` anchors the popover to the caret's x position and
  // stays fixed while the query grows.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<FileMentionMenuHandle | null>(null);
  const [mention, setMention] = useState<{
    start: number;
    query: string;
    left: number;
  } | null>(null);

  // Prefetch the file index on workspace switch, so the first `@` is instant.
  useEffect(() => {
    setMention(null);
    if (workspacePath) useMentionIndexStore.getState().ensure(workspacePath);
  }, [workspacePath]);

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
  }, []);

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
  }, [workspacePath, caretLeftPx]);

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
  }, [mention]);

  const emitChange = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;
    // Keep the DOM truly empty when the text is, so the :empty placeholder
    // shows (browsers like to leave a stray <br> behind).
    const text = extractText(el);
    if (text === "" && el.innerHTML !== "") el.innerHTML = "";
    lastEmittedRef.current = text;
    onValueChange?.(text);
  }, [onValueChange]);

  const syncTags = useCallback(() => {
    const el = editableRef.current;
    if (el && !isComposingRef.current) renderFileTags(el);
  }, []);

  /** Replace the active `@query` trigger with the picked file's mention
   *  token (+ trailing space) and render it as a chip. */
  const handleMentionSelect = useCallback(
    (entry: MentionEntry) => {
      const el = editableRef.current;
      if (!el || !workspacePath) return;
      setMention(null);
      const token = mentionToken(joinPath(workspacePath, entry.rel)) + " ";
      const caret = getCaretOffset(el);
      const text = extractText(el);
      // Recompute the trigger at select time — the caret may have moved
      // since the menu last sampled it.
      const trigger = caret >= 0 ? findMentionTrigger(text, caret) : null;
      el.focus();
      if (!trigger) {
        insertTextAtCaret(el, token);
      } else {
        el.innerHTML = htmlFromText(
          text.slice(0, trigger.start) +
            token +
            text.slice(trigger.start + 1 + trigger.query.length),
        );
        setCaretOffset(el, trigger.start + token.length);
      }
      emitChange();
      syncTags();
    },
    [workspacePath, emitChange, syncTags],
  );
  // Ghost-text completion from prompt history (desktop-cc-gui parity):
  // suffix is painted via data-completion-suffix and accepted with Tab.
  const completion = usePromptCompletion(isComposing ? "" : (value ?? ""));

  // Replace the field's content programmatically (history recall, Tab
  // accept): rebuild DOM from text, caret to end, emit upward.
  const setEditableText = useCallback(
    (text: string) => {
      const el = editableRef.current;
      if (!el) return;
      el.innerHTML = htmlFromText(text);
      setCaretOffset(el, text.length);
      emitChange();
      syncTags();
    },
    [emitChange, syncTags],
  );

  // ArrowUp/ArrowDown recall of previously submitted prompts.
  const { handleKeyDown: handleHistoryKeyDown } = usePromptHistoryNav({
    editableRef,
    setText: setEditableText,
  });

  // External value changes (draft restore on tab switch, clear on submit):
  // rebuild the DOM from text; our own emissions are already in the DOM.
  useEffect(() => {
    const v = value ?? "";
    if (v === lastEmittedRef.current) return;
    lastEmittedRef.current = v;
    const el = editableRef.current;
    if (el) el.innerHTML = htmlFromText(v);
    // The rebuilt DOM invalidates any live trigger range.
    setMention(null);
  }, [value]);

  // Expose the field handle (focus + mention insertion from the file tree).
  useEffect(() => {
    if (!inputRef) return;
    const handle: ComposerInputHandle = {
      focus: () => editableRef.current?.focus(),
      insertText: (text) => {
        const el = editableRef.current;
        if (!el) return;
        insertTextAtCaret(el, text);
        emitChange();
        syncTags();
      },
    };
    inputRef.current = handle;
    return () => {
      if (inputRef.current === handle) inputRef.current = null;
    };
  }, [inputRef, emitChange, syncTags]);

  // Chip × removal via delegation (chips are raw DOM, not React).
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      const close = (event.target as HTMLElement).closest?.(`.${FILE_TAG_CLASS}-close`);
      if (!close) return;
      event.preventDefault();
      event.stopPropagation();
      close.closest(`.${FILE_TAG_CLASS}`)?.remove();
      emitChange();
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [emitChange]);

  return (
    <div
      ref={wrapperRef}
      className={cx(
        "relative flex w-full flex-col gap-1 rounded-2xl border p-2 shadow-xs",
        isCollapsed
          ? "h-2 gap-0 border-transparent bg-transparent p-0 shadow-none"
          : "border-separator-border bg-background-primary-default",
        className,
      )}
    >
      <ComposerResizeHandle
        getHandleProps={getHandleProps}
        nudge={nudge}
        isResizing={isResizing}
        isCollapsed={isCollapsed}
      />
      {!isCollapsed && mention && workspacePath && (
        <FileMentionMenu
          root={workspacePath}
          query={mention.query}
          left={mention.left}
          onSelect={handleMentionSelect}
          onClose={() => setMention(null)}
          menuRef={mentionMenuRef}
        />
      )}

      {!isCollapsed && (
        <div
          ref={editableRef}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={t("chat.send")}
          data-placeholder={sendShortcut === "cmdEnter" ? t("chat.inputPlaceholderCmdEnter") : t("chat.inputPlaceholder")}
          data-completion-suffix={mention ? undefined : completion.suffix || undefined}
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
              mention &&
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
              completion.suffix &&
              !event.nativeEvent.isComposing &&
              !isComposingRef.current &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              const full = completion.accept();
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
            const files = Array.from(event.clipboardData?.items ?? [])
              .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((file): file is File => !!file);
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
      )}

      {!isCollapsed && (
        <div className="flex items-center gap-2 select-none">
          {addMenu}

          {cliMenu}

          {permissionMenu}

          <div aria-hidden className="min-w-0 flex-1" />

          {streaming ? (
            <button
              type="button"
              aria-label={t("chat.stop")}
              onClick={() => onStop?.()}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-button-primary p-2 transition-opacity duration-200 ease"
            >
              <CircleStop className="size-5 text-text-white" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("chat.send")}
              disabled={disabled}
              onClick={() => onSubmit?.(value ?? "")}
              className={cx(
                "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-button-primary p-2 transition-opacity duration-200 ease",
                disabled && "cursor-not-allowed opacity-40",
              )}
            >
              <ArrowUp className="size-5 text-text-white" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- status bar */
const CONTEXT_POPOVER_CLASSES = cx(
  "w-[340px] max-w-[calc(100vw-32px)] origin-bottom-right",
  "rounded-2xl border border-border-button-default bg-background-primary-default p-2 shadow-dropdown",
  "transition duration-150 ease-out",
  "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
  "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
);

const EMPTY_LIMITS: UsageLimit[] = [];
const EMPTY_PLAN = "";

/** 16px circular context meter at `pct` percent. */
function ContextRing({ pct }: { pct: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--color-agent-progress-ring)" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="var(--color-foreground-icon-tertiary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
      />
    </svg>
  );
}

export function StatusBar({
  branch,
  branches,
  onBranchSelect,
  folders,
  selectedFolder,
  onFolderSelect,
  usagePct,
  contextMax,
  contextSegments,
}: {
  branch?: string;
  /** Local branches for the switcher; empty until the first load. */
  branches?: BranchMenuItem[];
  /** Present → the branch label becomes a switcher dropdown. */
  onBranchSelect?: (name: string) => void;
  /** Workspace folder display names. */
  folders?: string[];
  selectedFolder?: string;
  onFolderSelect?: (name: string) => void;
  usagePct?: number;
  /** Context window size in tokens for the breakdown card. */
  contextMax?: number;
  /** Token buckets for the breakdown card; empty until usage is reported. */
  contextSegments?: ContextSegment[];
}) {
  const { t } = useTranslation();
  // `isNonModal` popovers don't dismiss on outside press (react-aria couples
  // the two); restore it manually — same fix as Select (see the hook doc).
  const [contextOpen, setContextOpen] = useState(false);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const contextPopoverRef = useRef<HTMLElement>(null);
  useDismissOnOutsidePress(contextOpen, () => setContextOpen(false), [
    contextTriggerRef,
    contextPopoverRef,
  ]);
  const allowContextOpenChange = useTriggerToggle(contextOpen, contextTriggerRef);
  const limitsContext = useMemo(
    () => ({ max: contextMax ?? 200_000, segments: contextSegments ?? [] }),
    [contextMax, contextSegments],
  );
  const limitsText = useMemo(
    () => ({
      contextWindow: t("chat.contextWindow"),
      freeSpace: t("chat.freeSpace"),
      planUsageLimits: t("chat.planUsageLimits"),
      managePlan: t("chat.managePlan"),
    }),
    [t],
  );
  return (
    <div className="flex h-[26px] w-full items-center justify-between select-none">
      <div className="flex items-center gap-3">
        {folders && folders.length > 0 && (
          <ProjectFolderMenu
            folders={folders}
            selectedName={selectedFolder}
            onSelect={onFolderSelect}
          />
        )}
        {branch &&
          (onBranchSelect ? (
            <BranchMenu
              branches={branches ?? []}
              currentName={branch}
              onSelect={onBranchSelect}
            />
          ) : (
            <span className="flex items-center gap-1">
              <GitMerge
                className="size-4 shrink-0 -scale-y-100 text-foreground-icon-secondary"
                aria-hidden
              />
              <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
                {branch}
              </span>
            </span>
          ))}
      </div>
      <div className="flex items-center gap-3">
        {/* Context meter is always on: 0% until the first usage report. */}
        <AriaDialogTrigger
          isOpen={contextOpen}
          onOpenChange={(o) => allowContextOpenChange(o) && setContextOpen(o)}
        >
          <AriaButton
            ref={contextTriggerRef}
            aria-label={t("chat.contextWindow")}
            className="flex cursor-pointer items-center gap-1 rounded-[40px] py-1 pr-2 pl-1.5 outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <ContextRing pct={usagePct ?? 0} />
            <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
              {usagePct ?? 0}%
            </span>
          </AriaButton>
          <AriaPopover
            ref={contextPopoverRef}
            isNonModal
            placement="top end"
            offset={8}
            className={CONTEXT_POPOVER_CLASSES}
          >
            <AriaDialog aria-label={t("chat.contextWindow")} className="outline-none">
              <AgentLimitsCard
                context={limitsContext}
                plan={EMPTY_PLAN}
                limits={EMPTY_LIMITS}
                text={limitsText}
              />
            </AriaDialog>
          </AriaPopover>
        </AriaDialogTrigger>
      </div>
    </div>
  );
}
