/**
 * pi/omp「供应商认证」区块 — ported from the reference desktop-cc-gui's
 * PiProviderAuthSection.tsx, generalized over the pi family (pi + omp) and
 * restyled onto this repo's settings rows (no custom CSS).
 *
 * - 订阅授权 group: read-only OAuth status + a 登录 button that hands the
 *   interactive flow to the built-in terminal (`launchPiFamilyLogin`).
 * - API Key group: search / featured-vs-all / three-state rows / inline key
 *   editor / delete with confirmation. Keys never round-trip to the frontend
 *   — list carries only a masked display string.
 * - 自定义供应商 group: raw-text editor over models.json (pi) / models.yml
 *   (omp) with loose backend validation.
 *
 * State is component-local: refresh on mount, after writes, and on window
 * focus (the OAuth flow completes in the terminal, outside this component).
 * After every write `notifyCliConfigChanged()` re-probes the chat model
 * catalogs — the CLIs filter available models by stored credentials.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Globe from "lucide-react/dist/esm/icons/globe";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import Search from "lucide-react/dist/esm/icons/search";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { ConfirmDialog } from "@/components/dialogs";
import {
  ipc,
  type PiFamilyAuthListResult,
  type PiFamilyAuthProviderSnapshot,
  type PiFamilyModelsConfigReadResult,
} from "@/lib/ipc";
import { cx } from "@/utils/cx";
import {
  PI_FAMILY_APIKEY_PROVIDERS,
  PI_FAMILY_OAUTH_PROVIDERS,
  type PiFamilyAuthUiProvider,
  type PiFamilyOauthProvider,
} from "./piFamilyAuthCatalog";
import { launchPiFamilyLogin } from "./piFamilyLogin";
import { notifyCliConfigChanged } from "./providers";

/** Same row chrome as CliConfigSection. */
const ROW =
  "flex min-h-[52px] w-full items-center gap-3 py-2.5 pr-2.5 border-b border-separator-border last:border-b-0";

const TEXT_BTN =
  "shrink-0 rounded-lg px-2 py-1 text-body-2-medium text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary disabled:opacity-40";

function BrandIcon({ iconSrc }: { iconSrc: string | null }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-tertiary">
      {iconSrc ? (
        <img src={iconSrc} alt="" className="size-5" aria-hidden />
      ) : (
        <Globe className="size-4 text-foreground-icon-secondary" aria-hidden />
      )}
    </span>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-1.5 rounded-full",
        on ? "bg-notification-success-foreground" : "bg-text-tertiary",
      )}
    />
  );
}

export function PiFamilyAuthSection({ engine }: { engine: "pi" | "omp" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<PiFamilyAuthListResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftVisible, setDraftVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PiFamilyAuthUiProvider | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ── custom providers (models.json / models.yml) ──
  const [modelsConfig, setModelsConfig] = useState<PiFamilyModelsConfigReadResult | null>(null);
  const [modelsEditorOpen, setModelsEditorOpen] = useState(false);
  const [modelsDraft, setModelsDraft] = useState("");
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const oauthProviders = PI_FAMILY_OAUTH_PROVIDERS[engine];
  const storePath = snapshot?.store.path ?? "";

  const refresh = useCallback(async () => {
    try {
      const [authResult, modelsResult] = await Promise.all([
        ipc.piFamilyAuthList(engine),
        ipc.piFamilyModelsConfigRead(engine),
      ]);
      setSnapshot(authResult);
      setModelsConfig(modelsResult);
      setLoadError(null);
    } catch (error) {
      setLoadError(String(error));
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // OAuth completes in the terminal, so the credential store changes behind
  // this component's back: refresh on window focus (event-driven, no polling).
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, PiFamilyAuthProviderSnapshot>();
    for (const item of snapshot?.providers ?? []) {
      map.set(item.id, item);
    }
    return map;
  }, [snapshot]);

  const oauthActive = useMemo(() => new Set(snapshot?.oauthProviders ?? []), [snapshot]);

  const visibleProviders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return PI_FAMILY_APIKEY_PROVIDERS.filter((provider) => {
      if (!showAll && !provider.featured && !normalized) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const envVar = byId.get(provider.id)?.envVar ?? "";
      return (
        provider.name.toLowerCase().includes(normalized) ||
        provider.id.includes(normalized) ||
        envVar.toLowerCase().includes(normalized)
      );
    });
  }, [query, showAll, byId]);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setDraftKey("");
    setDraftVisible(false);
    setActionError(null);
  }, []);

  const openEditor = useCallback(
    (id: string) => {
      if (editingId === id) {
        closeEditor();
        return;
      }
      setEditingId(id);
      setDraftKey("");
      setDraftVisible(false);
      setActionError(null);
    },
    [editingId, closeEditor],
  );

  const handleSave = useCallback(
    async (provider: PiFamilyAuthUiProvider) => {
      const key = draftKey.trim();
      if (!key) {
        // Empty = cancel, leave the credential untouched.
        closeEditor();
        return;
      }
      setSaving(true);
      setActionError(null);
      try {
        await ipc.piFamilyAuthSetApiKey(engine, provider.id, key);
        // Credentials gate the CLI's live model catalog — make the chat
        // pickers re-probe.
        notifyCliConfigChanged();
        closeEditor();
        await refresh();
      } catch (error) {
        setActionError(String(error));
      } finally {
        setSaving(false);
      }
    },
    [engine, draftKey, closeEditor, refresh],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await ipc.piFamilyAuthDeleteCredential(engine, deleteTarget.id);
      notifyCliConfigChanged();
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      setDeleteTarget(null);
      setActionError(String(error));
    }
  }, [engine, deleteTarget, refresh]);

  const openModelsEditor = useCallback(() => {
    if (modelsEditorOpen) {
      setModelsEditorOpen(false);
      setModelsDraft("");
      setModelsError(null);
      return;
    }
    // Missing/empty file → pre-fill the default example (written only on save).
    const existing = modelsConfig?.text ?? "";
    setModelsDraft(existing.trim() ? existing : (modelsConfig?.template ?? ""));
    setModelsError(null);
    setModelsEditorOpen(true);
  }, [modelsEditorOpen, modelsConfig]);

  const handleModelsSave = useCallback(async () => {
    setModelsSaving(true);
    setModelsError(null);
    try {
      await ipc.piFamilyModelsConfigWrite(engine, modelsDraft);
      // Custom providers join the CLI's model catalog too.
      notifyCliConfigChanged();
      setModelsEditorOpen(false);
      setModelsDraft("");
      await refresh();
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setModelsSaving(false);
    }
  }, [engine, modelsDraft, refresh]);

  // The CLI owns the interactive OAuth flow: close the settings overlay so
  // the user sees the terminal the login runs in.
  const handleLaunchLogin = useCallback(
    (provider: PiFamilyOauthProvider) => {
      void launchPiFamilyLogin(engine, provider.loginArg).then((launched) => {
        if (launched) {
          navigate("/");
        } else {
          setNotice(t("settings.piAuthLoginNoWorkspace"));
        }
      });
    },
    [engine, navigate, t],
  );

  const renderKeyState = (provider: PiFamilyAuthUiProvider) => {
    const state = byId.get(provider.id)?.state ?? "none";
    if (state === "configured") {
      return (
        <span className="flex items-center gap-1.5 text-body-2-regular text-text-secondary">
          <StatusDot on />
          {t("settings.piAuthConfigured")}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-body-2-regular text-text-tertiary">
        <StatusDot on={false} />
        {t("settings.piAuthNotConfigured")}
      </span>
    );
  };

  const renderEditor = (provider: PiFamilyAuthUiProvider) => {
    const snap = byId.get(provider.id);
    return (
      <div className="border-b border-separator-border px-2 py-3 last:border-b-0">
        <label
          className="mb-1.5 block text-body-2-medium text-text-secondary"
          htmlFor={`pi-family-auth-key-${provider.id}`}
        >
          API Key · {provider.name}
        </label>
        <div className="flex items-center gap-1 rounded-lg bg-background-tertiary px-2.5">
          <input
            id={`pi-family-auth-key-${provider.id}`}
            type={draftVisible ? "text" : "password"}
            value={draftKey}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDraftKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleSave(provider);
              } else if (event.key === "Escape") {
                closeEditor();
              }
            }}
            placeholder={
              snap?.state === "configured"
                ? t("settings.piAuthKeyPlaceholderKeep", { mask: snap.maskedKey ?? "" })
                : t("settings.piAuthKeyPlaceholderNew", { env: snap?.envVar ?? "API Key" })
            }
            className="h-9 min-w-0 flex-1 bg-transparent text-body-regular text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
            onClick={() => setDraftVisible((visible) => !visible)}
            title={t("settings.piAuthEdit")}
          >
            {draftVisible ? (
              <EyeOff className="size-3.5" aria-hidden />
            ) : (
              <Eye className="size-3.5" aria-hidden />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-body-2-regular text-text-tertiary">
          {t("settings.piAuthAdvancedTip")}
        </p>
        {actionError && editingId === provider.id ? (
          <p className="mt-1.5 text-body-2-regular text-text-error-primary" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave(provider)}
            className="rounded-lg bg-accent-500 px-3 py-1 text-body-2-medium text-white disabled:opacity-50"
          >
            {saving ? t("settings.piAuthSaving") : t("settings.piAuthSave")}
          </button>
          <button
            type="button"
            onClick={closeEditor}
            className="rounded-lg border border-border-button-default px-3 py-1 text-body-2-medium text-text-primary"
          >
            {t("common.cancel")}
          </button>
          <span className="min-w-0 truncate text-body-2-regular text-text-tertiary">
            {t("settings.piAuthSaveHint", { path: storePath })}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex w-full flex-col gap-6" data-testid="pi-family-auth-section">
      {notice && (
        <p role="status" className="text-body-regular text-text-secondary">
          {notice}
        </p>
      )}

      {/* ── 订阅授权 (read-only + terminal hand-off) ── */}
      <div className="flex w-full flex-col gap-2">
        <SettingsSectionLabel>
          {t("settings.piAuthOauthTitle")}
          <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
            {t("settings.piAuthOauthHint")}
          </span>
        </SettingsSectionLabel>
        <SettingsCard>
          {oauthProviders.map((provider) => {
            const subscribed = provider.statusIds.some((id) => oauthActive.has(id));
            return (
              <div className={ROW} key={provider.id}>
                <BrandIcon iconSrc={provider.iconSrc} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-body-regular text-text-primary">{provider.name}</p>
                  <p className="truncate text-body-2-regular text-text-secondary">
                    {t(`settings.piAuthOauthDesc${provider.descKey.charAt(0).toUpperCase()}${provider.descKey.slice(1)}`)}
                  </p>
                </div>
                <span
                  className={cx(
                    "flex shrink-0 items-center gap-1.5 text-body-2-regular",
                    subscribed ? "text-text-secondary" : "text-text-tertiary",
                  )}
                >
                  <StatusDot on={subscribed} />
                  {subscribed ? t("settings.piAuthSubscribed") : t("settings.piAuthNotSubscribed")}
                </span>
                <button
                  type="button"
                  onClick={() => handleLaunchLogin(provider)}
                  title={
                    engine === "pi"
                      ? `pi /login ${provider.loginArg}`
                      : `omp auth-broker login ${provider.loginArg}`
                  }
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-border-button-default px-2.5 py-1 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
                >
                  <LogIn className="size-3.5" aria-hidden />
                  {t("settings.piAuthLogin")}
                </button>
              </div>
            );
          })}
        </SettingsCard>
      </div>

      {/* ── API Key ── */}
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <SettingsSectionLabel>
            {t("settings.piAuthApiKeyTitle")}
            <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
              {t("settings.piAuthApiKeyHint", { path: storePath })}
            </span>
          </SettingsSectionLabel>
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-background-tertiary px-2.5">
            <Search className="size-3.5 text-foreground-icon-secondary" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.piAuthSearchPlaceholder")}
              className="h-8 w-44 bg-transparent text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
        </div>
        <SettingsCard>
          {loadError ? (
            <div className={cx(ROW, "text-body-regular text-text-error-primary")} role="alert">
              {t("settings.piAuthLoadFailed")}: {loadError}
            </div>
          ) : null}
          {visibleProviders.map((provider) => {
            const snap = byId.get(provider.id);
            const state = snap?.state ?? "none";
            const expanded = editingId === provider.id;
            return (
              <div key={provider.id}>
                <div className={cx(ROW, expanded && "border-b-0")}>
                  <BrandIcon iconSrc={provider.iconSrc} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-body-regular text-text-primary">{provider.name}</p>
                    <code className="w-fit truncate rounded border border-dashed border-border-button-default px-1 py-px text-[11px] text-text-tertiary">
                      {snap?.envVar ?? "—"}
                    </code>
                  </div>
                  {renderKeyState(provider)}
                  {state === "configured" && snap?.maskedKey ? (
                    <code className="shrink-0 rounded bg-background-tertiary px-1.5 py-0.5 text-[11px] text-text-secondary">
                      {snap.maskedKey}
                    </code>
                  ) : null}
                  {state === "configured" ? (
                    <>
                      <button
                        type="button"
                        className={TEXT_BTN}
                        onClick={() => openEditor(provider.id)}
                      >
                        {expanded ? t("settings.piAuthCollapse") : t("settings.piAuthEdit")}
                      </button>
                      <button
                        type="button"
                        className={cx(TEXT_BTN, "hover:text-text-error-primary")}
                        onClick={() => setDeleteTarget(provider)}
                      >
                        {t("settings.piAuthDelete")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-border-button-default px-2.5 py-1 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
                      onClick={() => openEditor(provider.id)}
                    >
                      {expanded ? t("settings.piAuthCollapse") : t("settings.piAuthSetKey")}
                    </button>
                  )}
                </div>
                {expanded ? renderEditor(provider) : null}
              </div>
            );
          })}
          {!loadError && visibleProviders.length === 0 ? (
            <div className={cx(ROW, "text-body-regular text-text-tertiary")}>
              {t("settings.piAuthEmptySearch", { query })}
            </div>
          ) : null}
          {!query.trim() ? (
            <button
              type="button"
              className={cx(ROW, "justify-center text-body-2-medium text-text-secondary hover:text-text-primary")}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? t("settings.piAuthShowLess")
                : t("settings.piAuthShowAll", { count: PI_FAMILY_APIKEY_PROVIDERS.length })}
            </button>
          ) : null}
          <div className="flex items-center gap-2 py-2 pr-2.5 text-[11px] text-text-tertiary">
            <code className="min-w-0 truncate">{storePath}</code>
            <span className="shrink-0 rounded bg-background-tertiary px-1 py-px">0600</span>
            <span className="shrink-0">·</span>
            <span className="min-w-0 truncate">{t("settings.piAuthResolutionOrder")}</span>
          </div>
        </SettingsCard>
      </div>

      {/* ── 自定义供应商 (models.json / models.yml) ── */}
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <SettingsSectionLabel>
            {t("settings.piAuthCustomTitle")}
            <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
              {t("settings.piAuthCustomHint", { path: modelsConfig?.file.path ?? "" })}
            </span>
          </SettingsSectionLabel>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-border-button-default px-2.5 py-1 text-body-2-medium text-text-primary hover:bg-background-secondary-hover"
            onClick={openModelsEditor}
          >
            {modelsEditorOpen ? t("settings.piAuthCollapse") : t("settings.piAuthEditConfig")}
          </button>
        </div>
        <SettingsCard>
          {modelsConfig?.parseError ? (
            <div className={cx(ROW, "text-body-regular text-text-error-primary")} role="alert">
              {t("settings.piAuthCustomParseError")}: {modelsConfig.parseError}
            </div>
          ) : null}
          {(modelsConfig?.providers ?? []).map((provider) => (
            <div className={ROW} key={provider.id}>
              <BrandIcon iconSrc={null} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-body-regular text-text-primary">
                  {provider.name ?? provider.id}
                </p>
                <code className="w-fit truncate rounded border border-dashed border-border-button-default px-1 py-px text-[11px] text-text-tertiary">
                  {provider.baseUrl ?? provider.id}
                </code>
              </div>
              {provider.api ? (
                <code className="shrink-0 rounded bg-background-tertiary px-1.5 py-0.5 text-[11px] text-text-secondary">
                  {provider.api}
                </code>
              ) : null}
              <span className="shrink-0 text-body-2-regular text-text-tertiary">
                {t("settings.piAuthCustomModelCount", { count: provider.modelCount })}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-body-2-regular text-text-secondary">
                <StatusDot on={provider.hasApiKey} />
                {provider.hasApiKey
                  ? t("settings.piAuthCustomHasKey")
                  : t("settings.piAuthCustomNoKey")}
              </span>
            </div>
          ))}
          {modelsConfig && modelsConfig.providers.length === 0 && !modelsConfig.parseError ? (
            <div className={cx(ROW, "text-body-regular text-text-tertiary")}>
              {modelsConfig.file.exists
                ? t("settings.piAuthCustomEmpty")
                : t("settings.piAuthCustomMissing")}
            </div>
          ) : null}
          {modelsEditorOpen ? (
            <div className="border-b border-separator-border px-2 py-3 last:border-b-0">
              <label
                className="mb-1.5 block text-body-2-medium text-text-secondary"
                htmlFor="pi-family-models-config-text"
              >
                {modelsConfig?.file.format === "yaml" ? "models.yml · YAML" : "models.json · JSONC"}
              </label>
              <textarea
                id="pi-family-models-config-text"
                value={modelsDraft}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                rows={16}
                onChange={(event) => setModelsDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    openModelsEditor();
                  }
                }}
                className="w-full resize-y rounded-lg bg-background-tertiary p-2.5 font-mono text-[12px] leading-relaxed text-text-primary outline-none"
              />
              <p className="mt-1.5 text-body-2-regular text-text-tertiary">
                {t("settings.piAuthCustomEditorTips")}
              </p>
              {modelsError ? (
                <p className="mt-1.5 text-body-2-regular text-text-error-primary" role="alert">
                  {modelsError}
                </p>
              ) : null}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={modelsSaving}
                  onClick={() => void handleModelsSave()}
                  className="rounded-lg bg-accent-500 px-3 py-1 text-body-2-medium text-white disabled:opacity-50"
                >
                  {modelsSaving ? t("settings.piAuthSaving") : t("settings.piAuthSave")}
                </button>
                <button
                  type="button"
                  onClick={openModelsEditor}
                  className="rounded-lg border border-border-button-default px-3 py-1 text-body-2-medium text-text-primary"
                >
                  {t("common.cancel")}
                </button>
                <span className="min-w-0 truncate text-body-2-regular text-text-tertiary">
                  {t("settings.piAuthSaveHint", { path: modelsConfig?.file.path ?? "" })}
                </span>
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-2 py-2 pr-2.5 text-[11px] text-text-tertiary">
            <code className="min-w-0 truncate">{modelsConfig?.file.path ?? ""}</code>
            <span className="shrink-0 rounded bg-background-tertiary px-1 py-px">0600</span>
          </div>
        </SettingsCard>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          danger
          message={t("settings.piAuthDeleteConfirm", { name: deleteTarget.name })}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
