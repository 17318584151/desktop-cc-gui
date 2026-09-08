import { AnimatePresence, m } from "motion/react";
import { useTranslation } from "react-i18next";
import Download from "lucide-react/dist/esm/icons/download";
import RefreshCcw from "lucide-react/dist/esm/icons/refresh-ccw";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { useUpdateStore } from "./store";

/**
 * Floating update banner, mounted once in App. Auto-check failures stay
 * silent; the toast appears when an update is actually available, tracks
 * download/install, and surfaces errors from user-initiated actions.
 */
export function UpdateToast() {
  const { t } = useTranslation();
  const stage = useUpdateStore((s) => s.stage);
  const version = useUpdateStore((s) => s.version);
  const downloadedBytes = useUpdateStore((s) => s.downloadedBytes);
  const totalBytes = useUpdateStore((s) => s.totalBytes);
  const error = useUpdateStore((s) => s.error);
  const startUpdate = useUpdateStore((s) => s.startUpdate);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const dismiss = useUpdateStore((s) => s.dismiss);

  const visible =
    stage === "available" ||
    stage === "downloading" ||
    stage === "installing" ||
    stage === "restarting" ||
    stage === "error";

  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18 }}
          role="status"
          className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-3 rounded-2xl border border-separator-border bg-background-primary-default p-4 shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Download className="size-[18px] shrink-0 text-foreground-icon-secondary" aria-hidden />
              <p className="text-body-medium text-text-primary">
                {stage === "available" && t("settings.updateAvailable", { version })}
                {stage === "downloading" &&
                  t("settings.updateDownloading") + (percent !== null ? ` ${percent}%` : "")}
                {stage === "installing" && t("settings.updateInstalling")}
                {stage === "restarting" && t("settings.updateRestarting")}
                {stage === "error" && t("settings.updateError", { message: error })}
              </p>
            </div>
            {(stage === "available" || stage === "error") && (
              <button
                type="button"
                onClick={dismiss}
                aria-label={t("settings.updateDismiss")}
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>

          {stage === "downloading" && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-background-secondary-default">
              <div
                className="h-full rounded-full bg-button-primary transition-[width]"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          )}

          {stage === "available" && (
            <div className="flex items-center justify-end gap-2">
              <Button size="small" variant="secondary" onClick={dismiss}>
                {t("settings.updateLater")}
              </Button>
              <Button size="small" variant="primary" onClick={() => void startUpdate()}>
                {t("settings.updateNow")}
              </Button>
            </div>
          )}

          {stage === "error" && (
            <div className="flex items-center justify-end gap-2">
              <Button size="small" variant="secondary" onClick={dismiss}>
                {t("settings.updateDismiss")}
              </Button>
              <Button
                size="small"
                variant="primary"
                leadingIcon={RefreshCcw}
                onClick={() => void checkForUpdates({ interactive: true })}
              >
                {t("settings.checkUpdates")}
              </Button>
            </div>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
}
