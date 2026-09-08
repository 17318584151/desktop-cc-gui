import { Fragment, useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
  SettingsValueField,
} from "@/components/application/settings/settings-rows";
import { ipc, type AppSettings, type DshCliVersion, type DshHostStatus } from "@/lib/ipc";
import { openExternal, pickFile } from "@/lib/platform";
import { cx } from "@/utils/cx";

const DSH_DOCS_URL = "https://github.com/deepseek-ai/dsh";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3080;
const PORT_MIN = 1;
const PORT_MAX = 65535;

/** Connection lifecycle, derived from the status snapshot + busy flags. */
type HostState = "checking" | "starting" | "missing" | "connected" | "down";

/**
 * DeepSeek Harness host section, embedded in the CLI 管理 dsh page after the
 * 引擎设置 card: CLI version/update, local host status (adopt or spawn on
 * demand), and the connection settings (custom bin path, host/port,
 * auto-start). Probes run on mount and explicit user actions only — the
 * host has no push channel and polling would keep the app awake for nothing.
 */
export function DshHostSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DshHostStatus | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [cli, setCli] = useState<DshCliVersion | null>(null);
  const [cliError, setCliError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Busy flags per action so buttons disable independently.
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [updating, setUpdating] = useState(false);
  // null = not yet decided; first status snapshot picks the default
  // (open when the host is down or auto-start is off).
  const [connOpen, setConnOpen] = useState<boolean | null>(null);
  // Raw drafts while editing host/port; null = show the saved value.
  const [hostDraft, setHostDraft] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState<string | null>(null);

  const refreshStatus = useCallback(async (manual = false) => {
    if (manual) setChecking(true);
    try {
      const next = await ipc.dshHostStatus();
      setStatus(next);
      setProbeError(null);
      setConnOpen((open) => open ?? (!next.running || next.autoStart === false));
    } catch (e) {
      setProbeError(String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  const refreshCli = useCallback(async () => {
    try {
      setCli(await ipc.dshCliVersion());
      setCliError(null);
    } catch (e) {
      setCliError(String(e));
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      refreshStatus(),
      refreshCli(),
      ipc.getAppSettings().then(setSettings).catch(() => {}),
    ]);
  }, [refreshStatus, refreshCli]);

  // Read-modify-write (same funnel as GeneralSection): the local snapshot
  // descends from a mount-time read, so apply each patch onto a fresh read
  // instead of persisting the whole object.
  const save = useCallback(async (patch: Partial<AppSettings>) => {
    try {
      const latest = await ipc.getAppSettings();
      const next = { ...latest, ...patch };
      await ipc.updateAppSettings(next);
      setSettings(next);
      setSaveError(null);
    } catch (e) {
      setSaveError(String(e));
    }
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const next = await ipc.dshHostStart();
      setStatus(next);
      setProbeError(null);
    } catch (e) {
      setProbeError(String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setStopping(true);
    try {
      await ipc.dshHostStop();
      setStatus((s) => (s ? { ...s, running: false, ownership: null, describe: null } : s));
      setProbeError(null);
      // Confirm against the real probe (stop may have missed an adopted host).
      void refreshStatus();
    } catch (e) {
      setProbeError(String(e));
    } finally {
      setStopping(false);
    }
  }, [refreshStatus]);

  const updateCli = useCallback(async () => {
    setUpdating(true);
    try {
      await ipc.dshCliUpdate();
      await Promise.all([refreshCli(), refreshStatus()]);
    } catch (e) {
      setCliError(String(e));
    } finally {
      setUpdating(false);
    }
  }, [refreshCli, refreshStatus]);

  // ---- Derived view state ----
  const host = status?.host ?? settings?.dshHost?.trim() ?? DEFAULT_HOST;
  const port = status?.port ?? settings?.dshPort ?? DEFAULT_PORT;
  const origin = status?.origin ?? `http://${host}:${port}`;
  const autoStart = status?.autoStart ?? (settings?.dshAutoStart !== false);
  const dshBin = settings?.dshBin?.trim() ?? "";
  const hostState: HostState = starting
    ? "starting"
    : status == null && !probeError
      ? "checking"
      : !status?.installed
        ? "missing"
        : status.running
          ? "connected"
          : "down";
  const actionBusy = checking || starting || stopping || updating;

  // ---- Host/port commits (draft on type, commit on blur/Enter) ----
  const commitHost = useCallback(() => {
    const draft = hostDraft?.trim();
    setHostDraft(null);
    if (!draft || draft === host) return;
    // Origin changed → re-probe after persisting.
    void save({ dshHost: draft }).then(() => void refreshStatus());
  }, [hostDraft, host, save, refreshStatus]);

  const commitPort = useCallback(() => {
    const draft = portDraft;
    setPortDraft(null);
    if (!draft) return;
    const n = Number(draft);
    if (!Number.isInteger(n) || n < PORT_MIN || n > PORT_MAX || n === port) return;
    void save({ dshPort: n }).then(() => void refreshStatus());
  }, [portDraft, port, save, refreshStatus]);

  const onFieldKeyDown = (commit: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      (e.target as HTMLElement).blur();
    }
  };

  const chooseBin = useCallback(async () => {
    const path = await pickFile(t("settings.dshCustomPath"), []);
    if (path) void save({ dshBin: path });
  }, [t, save]);

  // ---- Status card content ----
  const statusTitle: Record<HostState, string> = {
    checking: t("settings.dshChecking"),
    starting: t("settings.dshStarting"),
    missing: t("settings.dshNotInstalled"),
    connected: t("settings.dshHostConnected"),
    down: t("settings.dshHostDown"),
  };
  const dotClass: Record<HostState, string> = {
    connected: "bg-notification-success-foreground",
    down: "bg-text-error-primary",
    checking: "bg-background-quaternary-default",
    starting: "bg-background-quaternary-default",
    missing: "bg-background-quaternary-default",
  };

  const facts: ReactNode[] = [];
  const describe = hostState === "connected" ? status?.describe : null;
  if (describe?.provider) {
    facts.push(
      <Fragment key="provider">
        {t("settings.dshCurrentProvider")}{" "}
        <span className="text-text-primary">{describe.provider}</span>
      </Fragment>,
    );
  }
  if (describe?.model) {
    facts.push(
      <Fragment key="model">
        {t("settings.dshCurrentModel")}{" "}
        <span className="text-text-primary">{describe.model}</span>
      </Fragment>,
    );
  }
  if (describe?.attachedSessions != null) {
    facts.push(
      <Fragment key="sessions">
        {t("settings.dshAttachedSessions")}{" "}
        <span className="text-text-primary">{describe.attachedSessions}</span>
      </Fragment>,
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Section header: label + version hint, docs/update/refresh right —
          same row pattern as the 供应商渠道 header in CliConfigBody. */}
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

      {/* Status card */}
      <div className="flex w-full flex-col gap-2">
        <div
          aria-live="polite"
          className="flex w-full flex-col gap-3 rounded-2xl bg-background-secondary-default p-3"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className={cx("size-2 shrink-0 rounded-full", dotClass[hostState])} />
            <p className="text-body-medium text-text-primary">{statusTitle[hostState]}</p>
          </div>
          {hostState === "connected" && (
            <p className="text-body-2-regular text-text-secondary">
              {t("settings.dshConnectedOrigin", { origin })}
            </p>
          )}
          {facts.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-1 text-body-2-regular text-text-secondary">
              {facts.map((fact, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="text-text-tertiary">｜</span>}
                  {fact}
                </Fragment>
              ))}
            </p>
          )}
          {hostState === "down" && (
            <div className="flex flex-col gap-1">
              <p className="text-body-2-regular text-text-secondary">
                {t("settings.dshDownHint", { origin })}
              </p>
              {status?.error && (
                <p className="text-body-2-regular text-text-tertiary">{status.error}</p>
              )}
            </div>
          )}
          {hostState === "missing" && (
            <p className="text-body-2-regular text-text-secondary">{t("settings.dshMissingHint")}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            {hostState === "connected" && (
              <>
                <Button size="small" onClick={() => openExternal(origin)}>
                  {t("settings.dshOpenUi")}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => void stop()}
                >
                  {t("settings.dshStopService")}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => void refreshStatus(true)}
                >
                  {t("settings.dshRecheck")}
                </Button>
              </>
            )}
            {hostState === "down" && (
              <>
                <Button size="small" disabled={actionBusy} onClick={() => void start()}>
                  {t("settings.dshStartNow")}
                </Button>
                <Button size="small" variant="secondary" onClick={() => openExternal(origin)}>
                  {t("settings.dshOpenUi")}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => void refreshStatus(true)}
                >
                  {t("settings.dshRecheck")}
                </Button>
              </>
            )}
            {hostState === "missing" && (
              <>
                <Button size="small" disabled={actionBusy} onClick={() => void updateCli()}>
                  {updating ? t("settings.dshUpdating") : t("settings.dshInstall")}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => void refreshStatus(true)}
                >
                  {t("settings.dshRecheck")}
                </Button>
              </>
            )}
            {(hostState === "starting" || hostState === "checking") && (
              <Button size="small" disabled>
                {statusTitle[hostState]}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Connection settings (collapsible) */}
      <div className="flex w-full flex-col gap-2">
        <button
          type="button"
          aria-expanded={connOpen ?? false}
          onClick={() => setConnOpen((open) => !(open ?? true))}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2lg px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-body-medium text-text-primary">
              {t("settings.dshConnectionSettings")}
            </span>
            <span className="truncate text-body-2-regular text-text-secondary">
              {t("settings.dshConnectionSummary", {
                origin: `${host}:${port}`,
                autoStart: t(autoStart ? "settings.dshAutoStartOn" : "settings.dshAutoStartOff"),
              })}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cx(
              "size-4 shrink-0 text-foreground-icon-secondary transition-transform duration-150",
              connOpen && "rotate-180",
            )}
          />
        </button>
        {connOpen && (
          <SettingsCard>
            <SettingsRow
              label={t("settings.dshCustomPath")}
              description={t("settings.dshCustomPathHint")}
            >
              <div className="flex items-center gap-2">
                <SettingsValueField muted={!dshBin} className="w-40">
                  {dshBin || t("settings.dshCustomPathSystem")}
                </SettingsValueField>
                <Button size="small" variant="secondary" onClick={() => void chooseBin()}>
                  {t("settings.dshChoose")}
                </Button>
                {dshBin && (
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => void save({ dshBin: null })}
                  >
                    {t("settings.dshClear")}
                  </Button>
                )}
              </div>
            </SettingsRow>
            <SettingsRow
              label={t("settings.dshHostAddress")}
              description={t("settings.dshHostAddressHint")}
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t("settings.dshHostLabel")}
                  size="small"
                  className="w-36"
                  value={hostDraft ?? host}
                  onChange={setHostDraft}
                  onBlur={commitHost}
                  onKeyDown={onFieldKeyDown(commitHost)}
                />
                <Input
                  aria-label={t("settings.dshPortLabel")}
                  size="small"
                  className="w-24"
                  inputClassName="text-center"
                  inputMode="numeric"
                  value={portDraft ?? String(port)}
                  onChange={(v) => setPortDraft(v.replace(/\D/g, ""))}
                  onBlur={commitPort}
                  onKeyDown={onFieldKeyDown(commitPort)}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              label={t("settings.dshAutoStart")}
              description={t("settings.dshAutoStartHint")}
            >
              <Switch
                aria-label={t("settings.dshAutoStart")}
                size="sm"
                isSelected={autoStart}
                onChange={(isSelected) => void save({ dshAutoStart: isSelected })}
              />
            </SettingsRow>
          </SettingsCard>
        )}
      </div>
    </div>
  );
}
