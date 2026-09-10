import ArrowUp from "lucide-react/dist/esm/icons/arrow-up";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Download from "lucide-react/dist/esm/icons/download";
import Check from "lucide-react/dist/esm/icons/check";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { openExternal } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { ENGINE_DOCS_URLS, type EngineId } from "./providers";
import { CliUpdateDialog } from "./CliUpdateDialog";
import { useCliUpdateFlow } from "./useCliUpdateFlow";
import { useCliVersionStatus } from "./useCliVersionStatus";

/**
 * CLI 管理 page-header cluster: icon-only docs and refresh buttons flanking
 * a single segmented pill — the left segment carries the version status
 * (checking / not installed / local version + ✓ or ↑), the right segment is
 * the install/update CTA naming the target version. One piece of information
 * (current → target) reads as one control, and every element shares the
 * small-button 32px height.
 *
 * Version data comes from the shared session store (useCliVersionStatus) —
 * probes run on mount and the refresh button only, so opening settings never
 * blocks on `npm view`.
 */
export function CliHeaderActions({ engine }: { engine: EngineId }) {
  const { t } = useTranslation();
  const { status, loading, error, updating, refresh} = useCliVersionStatus(engine);
  const updateFlow = useCliUpdateFlow(engine);

  const installed = status?.installed === true;
  const localVersion = status?.localVersion ?? null;
  const latestVersion = status?.latestVersion ?? null;
  const updateAvailable = status?.updateAvailable === true;
  // No lifecycle action when the engine has no install channel (grok), and
  // no segment while the status is still unknown or nothing needs doing.
  const showLifecycle =
    status !== null && status.updateKind !== null && (!installed || updateAvailable);

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2" title={error ?? undefined}>
      <Button
        iconOnly
        size="small"
        variant="ghost"
        leadingIcon={BookOpen}
        aria-label={t("settings.cliDocs")}
        onClick={() => openExternal(ENGINE_DOCS_URLS[engine])}
      />
      <Button
        iconOnly
        size="small"
        variant="ghost"
        leadingIcon={RefreshCw}
        aria-label={t("settings.cliRefresh")}
        disabled={loading || updating}
        className={loading ? "[&_svg]:animate-spin" : undefined}
        onClick={refresh}
      />
      <span className="inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg border border-border-button-default bg-background-primary-default shadow-xs">
        <span
          className={cx(
            "inline-flex items-center gap-1.5 px-2.5 text-[13px]",
            status === null && error
              ? "bg-background-tertiary-warning text-text-warning-primary"
              : "bg-background-tertiary-default text-text-secondary",
          )}
        >
          {status === null ? (
            error ? (
              t("settings.cliVersionCheckFailed")
            ) : (
              t("settings.cliVersionChecking")
            )
          ) : !installed ? (
            t("settings.cliVersionNotInstalled")
          ) : localVersion ? (
            <>
              {updateAvailable ? (
                <ArrowUp className="size-3.5 text-text-warning-primary" aria-hidden />
              ) : latestVersion ? (
                <Check
                  className="size-3.5 text-state-success-text"
                  aria-label={t("settings.cliVersionUpToDate")}
                />
              ) : null}
              {t("settings.cliVersionLabel", { version: localVersion })}
            </>
          ) : null}
        </span>
        {showLifecycle ? (
          <button
            type="button"
            className={cx(
              "inline-flex cursor-pointer items-center gap-1 px-2.5 text-[13px] font-medium",
              "bg-button-primary text-text-white",
              "disabled:cursor-not-allowed disabled:text-button-primary-disabled-foreground",
            )}
            disabled={updating || loading}
            onClick={() => void updateFlow.begin()}
          >
            {updating ? null : installed ? (
              <ArrowUp className="size-3.5" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {updating
              ? t("settings.cliUpdating")
              : installed
                ? t("settings.cliUpdateTo", { version: latestVersion ?? "" })
                : t("settings.cliInstall")}
          </button>
        ) : null}
      </span>
      <CliUpdateDialog engine={engine} flow={updateFlow} />
    </div>
  );
}
