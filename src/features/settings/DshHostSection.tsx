import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Button } from "@/components/base/buttons/button";
import { SettingsSectionLabel } from "@/components/application/settings/settings-rows";
import { openExternal } from "@/lib/platform";
import { DshConnectionCard } from "./DshConnectionCard";
import { DshHostStatusCard } from "./DshHostStatusCard";
import { useDshHost, type DshHostSectionState } from "./useDshHost";

const DSH_DOCS_URL = "https://github.com/deepseek-ai/dsh";

/** Section header: label + version hint, docs/update/refresh right —
 *  same row pattern as the 供应商渠道 header in CliConfigBody. */
function DshHostHeader({ dsh }: { dsh: DshHostSectionState }) {
  const { t, cli, updating, updateCli, refreshCli } = dsh;
  return (
    <div className="flex items-center justify-between gap-3">
      <SettingsSectionLabel>
        {t("settings.dshLocalHost")}
        {cli?.installed && cli.localVersion && (
          <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
            {t("settings.dshVersionLabel", { version: cli.localVersion })}
            {cli.updateAvailable && cli.latestVersion ? (
              <span className="text-text-warning-primary">
                {" "}
                {t("settings.dshUpdateAvailable", { version: cli.latestVersion })}
              </span>
            ) : (
              <span> · {t("settings.dshVersionUpToDate")}</span>
            )}
          </span>
        )}
      </SettingsSectionLabel>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="small" variant="ghost" onClick={() => openExternal(DSH_DOCS_URL)}>
          {t("settings.dshDocs")}
        </Button>
        <Button size="small" disabled={updating} onClick={() => void updateCli()}>
          {updating
            ? t("settings.dshUpdating")
            : cli?.installed
              ? t("settings.dshUpdate")
              : t("settings.dshInstall")}
        </Button>
        <Button
          iconOnly
          size="small"
          variant="secondary"
          leadingIcon={RefreshCw}
          aria-label={t("settings.dshRefresh")}
          disabled={updating}
          onClick={() => void refreshCli()}
        />
      </div>
    </div>
  );
}

/**
 * DeepSeek Harness host section, embedded in the CLI 管理 dsh page after the
 * 引擎设置 card: CLI version/update, local host status (adopt or spawn on
 * demand), and the connection settings (custom bin path, host/port,
 * auto-start). Probes run on mount and explicit user actions only — the
 * host has no push channel and polling would keep the app awake for nothing.
 */
export function DshHostSection() {
  const dsh = useDshHost();
  const { t, cliError, saveError, probeError } = dsh;

  return (
    <div className="flex w-full flex-col gap-3">
      <DshHostHeader dsh={dsh} />

      {cliError && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {cliError}
        </p>
      )}

      {/* Tip banner: providers/keys live in the DSH Web UI, not here. */}
      <div className="flex w-full items-start gap-2 rounded-2xl bg-background-secondary-default px-3 py-2.5">
        <span className="shrink-0 rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-1-medium text-text-secondary">
          {t("settings.dshTipLabel")}
        </span>
        <p className="min-w-0 text-body-2-regular text-text-secondary">{t("settings.dshTipNote")}</p>
      </div>

      {saveError && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {saveError}
        </p>
      )}
      {probeError && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {probeError}
        </p>
      )}

      <DshHostStatusCard dsh={dsh} />
      <DshConnectionCard dsh={dsh} />
    </div>
  );
}
