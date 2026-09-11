import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Smartphone from "lucide-react/dist/esm/icons/smartphone";
import Check from "lucide-react/dist/esm/icons/check";
import { Button } from "@/components/base/buttons/button";
import {
  SettingsCard,
  SettingsRow,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { ipc, type RelayInfo, type WebAccessInfo, type WebDevice } from "@/lib/ipc";
import { Input } from "@/components/base/input/input";
import { listenRelay, listenSettingsChanged, listenWebDevices } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { isWeb } from "@/lib/platform";
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
    void ipc.webRelayStatus().then(setRelay).catch(() => {});
  }, []);

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

  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsSectionLabel>{t("settings.webAccess")}</SettingsSectionLabel>
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
        <SettingsCard>
          <SettingsRow
            label={t("settings.webRelay")}
          >
            {(
              <Button
                size="small"
                variant={relay ? "secondary" : "primary"}
                disabled={relayBusy || (!relay && (!relayUrl.trim() || !relayKey.trim()))}
                onClick={() => void (relay ? stopRelay() : startRelay())}
              >
                {relay ? t("settings.webRelayStop") : t("settings.webRelayStart")}
              </Button>
            )}
          </SettingsRow>
          <div className="flex w-full flex-col gap-2 px-3 pt-1 pb-3">
            <Input
              aria-label={t("settings.webRelayUrl")}
              size="small"
              placeholder="https://ccgui-relay.<account>.workers.dev"
              value={relayUrl}
              onChange={setRelayUrl}
            />
            <Input
              aria-label={t("settings.webRelayKey")}
              size="small"
              placeholder={t("settings.webRelayKeyHint")}
              value={relayKey}
              onChange={setRelayKey}
            />
            {relayError && (
              <p role="alert" className="text-body-2-regular text-text-error-primary">
                {relayError}
              </p>
            )}
            {/* No connected badge: the running task pushes a state event on
                every dial and drop, so a text line would flash and shove the
                page around on each reconnect. The button already carries the
                state (连接中转 / 断开中转); only failures earn a line. */}
            {relay?.error && (
              <p role="alert" className="text-body-2-regular text-text-error-primary">
                {t("settings.webRelayFailed")}: {relay.error}
              </p>
            )}
          </div>
        </SettingsCard>
        {/* The auth switch, pairing key and device list are settings-level:
            they belong to the relay, not to the LAN bridge's runtime — and
            hiding them whenever the bridge was stopped read as the whole
            feature having disappeared. */}
        <SettingsCard>
          <SettingsRow
            label={t("settings.webAuth")}
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
          {authEnabled && authKey && (
            <div className="flex w-full flex-col gap-2 px-3 pt-1 pb-3">
              <span className="text-body-2-regular text-text-secondary">
                {t("settings.webAuthKeyHint")}
              </span>
              <div className="flex h-9 w-52 items-center gap-1 rounded-2lg bg-background-tertiary-default pr-1 pl-3">
                <span className="flex-1 font-mono text-title-3 tracking-[0.18em] text-text-primary">
                  {authKey}
                </span>
                <button
                  type="button"
                  aria-label={t("settings.webAuthCopy")}
                  title={t("settings.webAuthCopy")}
                  onClick={() => void navigator.clipboard.writeText(authKey)}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
                >
                  <Copy className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          )}
          <SettingsRow
            label={t("settings.webDevices")}
          />
          {devices.length === 0 ? (
            <p className="px-3 pb-3 text-body-2-regular text-text-secondary">
              {t("settings.webDevicesEmpty")}
            </p>
          ) : (
            <div className="flex w-full flex-col">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex w-full items-center gap-3 border-t border-separator-border px-3 py-2.5"
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
