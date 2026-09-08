import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { cx } from "@/utils/cx";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";

/**
 * Shared shell for the small imperative dialogs below. Built on react-aria's
 * Modal/ModalOverlay/Dialog, which own the a11y contract outright: role +
 * aria-modal, the focus trap, Escape dismissal, outside-press dismissal
 * (`isDismissable`), and portalling to document.body.
 *
 * z-110, not z-50: the portalled overlay is a document.body sibling of
 * SettingsModal's z-100 overlay, so dialogs opened from inside settings
 * (add/edit/delete channel) must outrank it to stay visible.
 */
export function ModalShell({
  children,
  onClose,
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  /** Panel sizing override; defaults to the compact w-80 prompt size. */
  className?: string;
}) {
  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-110 flex items-center justify-center bg-overlay-backdrop"
    >
      <Modal
        isDismissable
        className={cx(
          "w-80 rounded-2lg border border-border-button-default bg-background-primary-default p-4 shadow-xl outline-none",
          className,
        )}
      >
        <Dialog className="outline-none">{children}</Dialog>
      </Modal>
    </ModalOverlay>
  );
}

interface PromptDialogProps {
  title: string;
  initial?: string;
  /** Helper text under the field. */
  hint?: string;
  placeholder?: string;
  /** Allow submitting the empty string (e.g. clearing an alias). */
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Single-field name prompt (new folder / rename). window.prompt is not
 * reliable inside Tauri's WKWebView, so this is a real modal. */
export function PromptDialog({
  title,
  initial = "",
  hint,
  placeholder,
  allowEmpty = false,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  // The field (not the first button) takes the initial focus, selected so a
  // rename can be typed over directly.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();

  return (
    <ModalShell onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed || allowEmpty) onSubmit(trimmed);
        }}
        className="flex flex-col gap-3"
      >
        <Input
          ref={inputRef}
          label={title}
          hint={hint}
          placeholder={placeholder}
          value={value}
          onChange={setValue}
          size="small"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="small" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="small" disabled={!allowEmpty && !trimmed}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

interface ConfirmDialogProps {
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra body content (e.g. the file list of the switch confirmation). */
  children?: ReactNode;
}

export function ConfirmDialog({ message, danger = false, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <ModalShell onClose={onCancel}>
      <p className="text-body-medium text-text-primary">{message}</p>
      {children}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {/* The confirm button takes the dialog's initial focus so Enter
         *  confirms instead of cancelling. */}
        <Button variant={danger ? "danger" : "primary"} size="small" autoFocus onClick={onConfirm}>
          {t("common.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}
