import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import Copy from "lucide-react/dist/esm/icons/copy";
import Smartphone from "lucide-react/dist/esm/icons/smartphone";
import Check from "lucide-react/dist/esm/icons/check";
import { Button } from "@/components/base/buttons/button";
import { InfoTip, Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { Focusable } from "react-aria-components";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { ipc, type RelayInfo, type WebAccessInfo, type WebDevice } from "@/lib/ipc";
import { Input } from "@/components/base/input/input";
import { listenRelay, listenSettingsChanged, listenWebDevices } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { isWeb, pickSavePath } from "@/lib/platform";
import { cx } from "@/utils/cx";

/** Matches the code the phone shows while it waits for approval. */
function deviceCode(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** "iPhone · Safari": the raw UA is unreadable in a list row. */
function summarizeUa(ua: string): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [os, browser].filter(Boolean).join(" · ");
}

/**
 * Mobile/web access page: starts the LAN bridge (src-tauri/src/web.rs) and
 * shows the token-bearing URL as text + QR. Start/stop are desktop-only —
 * the bridge does not route them, so on web this page is a read-only status.
 */
export function WebAccessSection() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<WebAccessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Cloudflare API Token for the one-click deploy; kept in memory only —
   *  deploying is a once-per-user action, so storing a credential that can
   *  edit the whole account buys nothing. */
  const [apiToken, setApiToken] = useState("");
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployStatus, setDeployStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [devices, setDevices] = useState<WebDevice[]>([]);
  const [relay, setRelay] = useState<RelayInfo | null>(null);
  const [relayUrl, setRelayUrl] = useState("");
  const [relayKey, setRelayKey] = useState("");
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authKey, setAuthKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [pane, setPane] = useState<"lan" | "wan">("lan");

  const refreshDevices = useCallback(() => {
    void ipc
      .webDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    ipc
      .webAccessStatus()
      .then((status) => {
        if (!cancelled) setInfo(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refreshDevices(), [refreshDevices]);
  useTauriEvent(() => listenWebDevices(refreshDevices));
  useTauriEvent(() => listenRelay(refreshRelay));
  // The pairing key rotates by itself (after a pairing, and on a timer), so
  // this page re-reads settings whenever anything writes them.
  useTauriEvent(() => listenSettingsChanged(refreshAuth));

  const refreshRelay = useCallback(() => {
    void ipc
      .webRelayStatus()
      .then((status) => {
        setRelay(status);
        // A healthy backend clears any local error text: the connected event
        // and the failure text describe the same thing.
        if (status && !status.error) setRelayError(null);
      })
      .catch(() => {});
  }, []);

  // The status is event-driven while the page is open; the mount effect below
  // fetches it once so reopening settings shows the real state, not idle grey.
  useEffect(() => {
    refreshRelay();
    void ipc
      .getAppSettings()
      .then((s) => {
        setRelayUrl(s.webRelayUrl ?? "");
        setRelayKey(s.webRelayKey ?? "");
        setAuthEnabled(s.webAuthEnabled ?? false);
        setAuthKey(s.webAuthKey ?? "");
      })
      .catch(() => {});
  }, [refreshRelay]);

  /** Re-read the switch and the code from the backend: it rotates the key on
   *  its own (after a pairing, and on a timer), so the cached copy is exactly
   *  what must not be trusted here. */
  const refreshAuth = useCallback(
    () =>
      ipc
        .refreshAppSettings()
        .then((s) => {
          setAuthEnabled(s.webAuthEnabled ?? false);
          setAuthKey(s.webAuthKey ?? "");
        })
        .catch(() => {}),
    [],
  );

  /** Turning the switch on drops stored approvals and lets the backend mint
   *  the key (web_auth_key: null); the code is read back afterwards, so the
   *  screen always shows the one a phone has to type. */
  const setAuth = useCallback(
    async (enabled: boolean) => {
      setAuthBusy(true);
      try {
        const latest = await ipc.getAppSettings();
        await ipc.updateAppSettings({
          ...latest,
          webAuthEnabled: enabled,
          webAuthKey: null,
        });
        await refreshAuth();
      } finally {
        setAuthBusy(false);
      }
    },
    [refreshAuth],
  );

  const saveRelayFields = useCallback(async (url: string, key: string) => {
    const latest = await ipc.getAppSettings();
    await ipc.updateAppSettings({ ...latest, webRelayUrl: url || null, webRelayKey: key || null });
  }, []);

  const startRelay = useCallback(async () => {
    setRelayBusy(true);
    setRelayError(null);
    try {
      const info = await ipc.webRelayStart(relayUrl.trim(), relayKey.trim());
      await saveRelayFields(relayUrl.trim(), relayKey.trim());
      setRelay(info);
      // Connecting the relay started the local bridge (it forwards through
      // it): re-read the status so 内网访问 does not sit on a stale 已停止.
      void ipc.webAccessStatus().then(setInfo).catch(() => {});
    } catch (e) {
      setRelayError(String(e));
    } finally {
      setRelayBusy(false);
    }
  }, [relayUrl, relayKey, saveRelayFields]);

  const stopRelay = useCallback(async () => {
    setRelayBusy(true);
    try {
      await ipc.webRelayStop();
      setRelay(null);
    } catch (e) {
      setRelayError(String(e));
    } finally {
      setRelayBusy(false);
    }
  }, []);

  const revoke = useCallback(
    (id: string) => {
      void ipc
        .webDeviceRevoke(id)
        .then(refreshDevices)
        .catch(() => {});
    },
    [refreshDevices],
  );

  const start = useCallback(async () => {
    setBusy(true);
    try {
      setInfo(await ipc.webAccessStart());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await ipc.webAccessStop();
      setInfo(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const copyUrl = useCallback(() => {
    if (!info) return;
    void navigator.clipboard.writeText(info.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [info]);

  /** Deploy the Worker into the user's account and fill both fields from the
   *  result, so the relay is usable without typing anything. The URL stays a
   *  plain input: whoever needs a custom domain (some regions cannot reach
   *  *.workers.dev) just edits it afterwards. */
  const deployRelay = useCallback(() => {
    void (async () => {
      setDeployBusy(true);
      setDeployStatus(null);
      try {
        const result = await ipc.relayDeploy(apiToken.trim(), relayKey.trim() || null);
        setRelayUrl(result.url);
        setRelayKey(result.key);
        // Persist right away: the key is uploaded as a Cloudflare secret, so
        // Cloudflare never shows it back — losing it here would mean the
        // Worker can only be used by deploying (and re-keying) again.
        await saveRelayFields(result.url, result.key);
        // The token is a one-shot credential: drop it the moment the deploy
        // lands, so it cannot sit in a running window.
        setApiToken("");
        setDeployStatus({
          ok: true,
          text: t("settings.webRelayDeployed", { account: result.accountName }),
        });
      } catch (error) {
        setDeployStatus({
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setDeployBusy(false);
      }
    })();
  }, [apiToken, relayKey, saveRelayFields, t]);

  /** Write the whole wrangler project (source + config + this key) to disk, so
   *  the user can read it and `npx wrangler deploy` it themselves. */
  const exportDeployPack = useCallback(() => {
    void (async () => {
      const path = await pickSavePath(t("settings.webRelayExportSource"), "ccgui-relay.zip");
      if (!path) return;
      try {
        const key = await ipc.relayDeployPack(path, relayKey.trim() || null);
        // The pack carries a key; adopt it when the field was still empty so
        // GUI and pack never disagree.
        if (!relayKey.trim()) setRelayKey(key);
        setDeployStatus(null);
      } catch (error) {
        setDeployStatus({
          ok: false,
          text: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [relayKey, t]);

  // Relay state dot: driven by the backend's own state, so a reconnect clears
  // it by itself. (`relayError` is a local, sticky flag — folding it into the
  // colour kept the dot red long after the relay had reconnected; it only
  // serves as fallback text now.)
  //
  // The dot doubles as the error surface: relay failures run long ("IO error:
  // 由于目标计算机积极拒绝，无法连接。 (os error 10061)") and an inline line
  // would shove the whole card row up and down on every reconnect. Same
  // pattern as the deploy status icon.
  const relayState = relay?.error
    ? {
        dot: "bg-text-error-primary",
        text: `${t("settings.webRelayFailed")}: ${relay.error}`,
      }
    : relay?.connected
      ? { dot: "bg-[var(--color-status-unseen)]", text: t("settings.webRelayStateLive") }
      : {
          dot: "bg-foreground-icon-tertiary",
          text: relayError || t("settings.webRelayStateIdle"),
        };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-fit items-center gap-1 rounded-full bg-background-tertiary-default p-1">
        {(["lan", "wan"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={pane === id}
            onClick={() => setPane(id)}
            className={cx(
              "cursor-pointer rounded-full px-3 py-1 text-body-2-medium transition-colors",
              pane === id
                ? "bg-background-primary-default text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {t(id === "lan" ? "settings.webLan" : "settings.webWan")}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
      {pane === "lan" && (
        <>
        <SettingsCard>
          <SettingsRow
            label={info ? t("settings.webAccessRunning") : t("settings.webAccessStopped")}
            description={t("settings.webAccessDesc")}
          >
            {!isWeb && (
              <Button
                size="small"
                variant={info ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => void (info ? stop() : start())}
              >
                {info ? t("settings.webAccessStop") : t("settings.webAccessStart")}
              </Button>
            )}
          </SettingsRow>
          {info && (
            <div className="flex w-full flex-col gap-2 py-3 pr-3">
              <p className="text-body-regular text-text-primary">{t("settings.webAccessUrl")}</p>
              <div className="flex h-8 w-full items-center gap-1 rounded-2lg bg-background-tertiary-default pr-1 pl-2">
                <span
                  className="min-w-0 flex-1 truncate text-body-regular text-text-primary"
                  title={info.url}
                >
                  {info.url}
                </span>
                <button
                  type="button"
                  aria-label={t("settings.webAccessCopy")}
                  title={copied ? t("common.copied") : t("settings.webAccessCopy")}
                  onClick={copyUrl}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
                >
                  {copied ? (
                    <Check className="size-4 text-notification-success-foreground" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              <p className="text-body-2-regular text-text-secondary">{t("settings.webAccessScanHint")}</p>
            </div>
          )}
        </SettingsCard>
        {info && (
          <div className="flex w-full flex-col items-center gap-3 py-2">
            <div className="rounded-2xl border border-separator-border bg-white p-3 shadow-sm">
              <QRCodeSVG value={info.url} size={180} />
            </div>
            <p className="max-w-[420px] text-center text-body-2-regular text-text-error-primary">
              {t("settings.webAccessWarning")}
            </p>
          </div>
        )}
        </>
      )}
      {pane === "wan" && (
        <>
        <div className="flex w-full items-stretch gap-2">
        {/* 部署中转 */}
        <div className="flex min-w-0 flex-1">
        <SettingsCard>
          <SettingsRow
            label={t("settings.webRelayDeploy")}
            labelAdornment={
              <InfoTip label={t("settings.webRelayDeployHint")} icon={CircleAlert} />
            }
          >
            <Button
              size="small"
              variant="primary"
              disabled={deployBusy || !apiToken.trim()}
              onClick={deployRelay}
            >
              {t("settings.webRelayDeployNow")}
            </Button>
          </SettingsRow>
          <div className="flex w-full flex-col gap-2 pt-3 pr-3 pb-3">
            <Input
              aria-label={t("settings.webRelayApiKey")}
              type="password"
              size="small"
              placeholder={t("settings.webRelayApiKeyPlaceholder")}
              value={apiToken}
              onChange={setApiToken}
            />
            <div className="flex items-center gap-2">
              <Button size="small" variant="secondary" onClick={exportDeployPack}>
                {t("settings.webRelayExportSource")}
              </Button>
              {deployStatus && (
                // Icon only (the message can be long); hovering it reveals the
                // whole Cloudflare answer, so the row keeps its shape.
                <Tooltip delay={150}>
                  <Focusable>
                    <button
                      type="button"
                      aria-label={deployStatus.text}
                      className={cx(
                        "flex size-5 shrink-0 cursor-help items-center justify-center",
                        deployStatus.ok
                          ? "text-notification-success-foreground"
                          : "text-text-error-primary",
                      )}
                    >
                      {deployStatus.ok ? (
                        <Check className="size-4" aria-hidden />
                      ) : (
                        <CircleAlert className="size-4" aria-hidden />
                      )}
                    </button>
                  </Focusable>
                  <TooltipContent className="max-w-[320px]">{deployStatus.text}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </SettingsCard>
        </div>
        {/* 中转服务：地址与密钥始终可手填，挂自定义域名也在这里改 */}
        <div className="flex min-w-0 flex-1">
        <SettingsCard>
          <SettingsRow
            label={t("settings.webRelay")}
            labelAdornment={
              <Tooltip delay={150}>
                <Focusable>
                  <button
                    type="button"
                    aria-label={relayState.text}
                    className="flex size-3.5 shrink-0 cursor-help items-center justify-center"
                  >
                    <span className={cx("size-2 rounded-full", relayState.dot)} aria-hidden />
                  </button>
                </Focusable>
                <TooltipContent className="max-w-[320px] whitespace-pre-line">
                  {relayState.text}
                </TooltipContent>
              </Tooltip>
            }
          >
            <Button
              size="small"
              variant={relay ? "secondary" : "primary"}
              disabled={relayBusy || (!relay && (!relayUrl.trim() || !relayKey.trim()))}
              onClick={() => void (relay ? stopRelay() : startRelay())}
            >
              {relay ? t("settings.webRelayStop") : t("settings.webRelayStart")}
            </Button>
          </SettingsRow>
          <div className="flex w-full flex-col gap-2 pt-3 pr-3 pb-3">
            <Input
              aria-label={t("settings.webRelayUrl")}
              size="small"
              placeholder="https://ccgui-relay.<account>.workers.dev"
              value={relayUrl}
              onChange={setRelayUrl}
            />
            <Input
              aria-label={t("settings.webRelayKey")}
              type="password"
              size="small"
              placeholder={t("settings.webRelayKeyHint")}
              value={relayKey}
              onChange={setRelayKey}
            />
            {/* No inline error line: the state dot's tooltip carries the full
                message, so a failure (or its disappearance on reconnect) never
                changes the card's height. */}
          </div>
        </SettingsCard>
        </div>
        {/* The auth switch and pairing key are settings-level: they belong to
            the relay, not to the LAN bridge's runtime — and hiding them
            whenever the bridge was stopped read as the whole feature having
            disappeared. */}
        <div className="flex min-w-0 flex-1">
        <SettingsCard>
          <SettingsRow
            label={t("settings.webAuth")}
            labelAdornment={
              <InfoTip label={t("settings.webAuthKeyHint")} icon={CircleAlert} />
            }
          >
            <Button
              size="small"
              variant={authEnabled ? "secondary" : "primary"}
              disabled={authBusy}
              onClick={() => void setAuth(!authEnabled)}
            >
              {authEnabled ? t("settings.webAuthDisable") : t("settings.webAuthEnable")}
            </Button>
          </SettingsRow>
          {(() => {
            // The box is always there — with the switch off it shows a dash
            // placeholder so the card keeps its shape and the reader sees that
            // a key exists only while authorization is on. The copy button is
            // disabled then, so the placeholder can never be copied out.
            const canCopyKey = authEnabled && Boolean(authKey);
            return (
              <div className="flex w-full flex-1 items-center justify-center pt-3 pr-3 pb-3">
                <div className="flex h-9 w-fit items-center rounded-2lg bg-background-tertiary-default pr-1 pl-3">
                  <span className="font-mono text-title-3 tracking-[0.18em] text-text-primary">
                    {canCopyKey ? authKey : "--------"}
                  </span>
                  <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-separator-border-strong" />
                  <button
                    type="button"
                    aria-label={t("settings.webAuthCopy")}
                    title={t("settings.webAuthCopy")}
                    disabled={!canCopyKey}
                    onClick={() => {
                      if (canCopyKey) void navigator.clipboard.writeText(authKey);
                    }}
                    className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:cursor-default disabled:text-foreground-icon-quaternary disabled:hover:bg-transparent"
                  >
                    <Copy className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })()}
        </SettingsCard>
        </div>
        </div>
        {/* 已授权设备：独立功能区 */}
        <SettingsCard>
          <SettingsRow
            label={t("settings.webDevices")}
          />
          {devices.length === 0 ? (
            <p className="pt-3 pr-3 pb-3 text-body-2-regular text-text-secondary">
              {t("settings.webDevicesEmpty")}
            </p>
          ) : (
            <div className="flex w-full flex-col">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex w-full items-center gap-3 border-t border-separator-border py-2.5 pr-3"
                >
                  <Smartphone className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-regular text-text-primary">
                      {summarizeUa(device.userAgent) || t("settings.webDeviceAnonymous")}
                    </span>
                    <span className="text-body-2-regular text-text-secondary">
                      {t("settings.webDeviceCode")} {deviceCode(device.id)}
                    </span>
                  </div>
                  <Button size="small" variant="secondary" onClick={() => revoke(device.id)}>
                    {t("settings.webDeviceRevoke")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
        </>
      )}
    </div>
  );
}
