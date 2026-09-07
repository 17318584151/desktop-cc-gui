import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Globe from "lucide-react/dist/esm/icons/globe";
import Download from "lucide-react/dist/esm/icons/download";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import EllipsisVertical from "lucide-react/dist/esm/icons/ellipsis-vertical";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Switch } from "@/components/base/switch/switch";
import { Button } from "@/components/base/buttons/button";
import {
  Dropdown,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import {
  WorkspaceSortableList,
  type RepoDragChrome,
} from "@/components/application/ai-chat/workspace-sortable-list";
import { ConfirmDialog } from "@/components/dialogs";
import { CLI_DISPLAY_NAMES, inferModelEngine } from "@/components/foundations/icons/engine-brands";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { ipc, type CcSwitchStatus, type CliConfig } from "@/lib/ipc";
import { pickFile } from "@/lib/platform";
import { cx } from "@/utils/cx";
import ccSwitchIcon from "@/assets/model-icons/cc-switch.png";
import {
  PSEUDO_DISABLED,
  PSEUDO_LOCAL,
  notifyCliConfigChanged,
  providerEntries,
  stripConventionEnv,
  type EngineId,
  type ProviderEntry,
} from "./providers";
import { ProviderDialog, type ProviderFormValue } from "./ProviderDialog";
import { PiFamilyAuthSection } from "./PiFamilyAuthSection";
import { SortableEngineTabs } from "./SortableEngineTabs";

/**
 * CLI 配置 page — the BoardUI ai-chat "Tools" template language:
 *   pill tabs (one per CLI, drag to reorder — SortableEngineTabs)
 *   → 引擎设置 card (enable switch + 官方配置 row)
 *   → 供应商渠道 card (avatar/switch/⋯-menu rows + drag sorting)
 *   → empty state.
 *
 * Semantics (single source of truth is the backend's single `current`):
 *   - Each row carries a Switch showing whether it is current; flipping a
 *     switch on makes that channel current (single-select, radio-style).
 *     Flipping the current custom channel off falls back to 官方配置; the
 *     官方配置 switch can only be turned on, never off.
 *   - 停用 is a per-CLI state (the enable switch), not a channel row.
 *   - 官方配置 is the built-in fallback (the CLI's own config file) and
 *     lives in the 引擎设置 card, next to the enable switch.
 */
/** Same chrome as SettingsRow's container, but free-form content. */
const ROW =
  "flex min-h-[52px] w-full items-center gap-3 py-2.5 pr-2.5 border-b border-separator-border last:border-b-0";

/** Engines cc-switch manages — the import dropdown only shows on these tabs. */
const CCS_IMPORT_ENGINES: readonly EngineId[] = ["claude", "codex", "grok"];

type Health =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; ms: number }
  | { state: "fail" };

function Badge({
  children,
  tone = "default",
}: {
  children: string;
  /** "warning" = orange, used for the cc-switch origin pill. */
  tone?: "default" | "warning";
}) {
  return (
    <span
      className={cx(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none",
        tone === "warning"
          ? "bg-background-tertiary-warning text-text-warning-primary"
          : "bg-background-tertiary-default text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}

/** host("https://api.moonshot.cn/anthropic") → "api.moonshot.cn". */
function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

/** Tinted rounded square with the inferred brand mark; doubles as the row's drag
 *  handle when `dragHandle` is set. */
function ChannelAvatar({
  entry,
  fallbackEngine,
  dragHandle,
}: {
  entry?: ProviderEntry;
  fallbackEngine: EngineId;
  /** Drag-handle wiring (label + pointer handler) from the sortable list. */
  dragHandle?: { label: string; props: RepoDragChrome["dragHandleProps"] };
}) {
  const fromCcSwitch =
    entry != null &&
    (entry.raw as Record<string, unknown>).source === "cc-switch";
  const brand = entry
    ? (inferModelEngine(entry.model) ?? inferModelEngine(entry.baseUrl))
    : fallbackEngine;
  const avatar = (
    <span className="flex size-9 items-center justify-center rounded-2lg bg-background-tertiary-default text-foreground-icon-primary">
      {fromCcSwitch ? (
        <img src={ccSwitchIcon} alt="" className="size-5" aria-hidden />
      ) : brand ? (
        <EngineIcon engine={brand} size={16} />
      ) : (
        <Globe className="size-4" aria-hidden />
      )}
    </span>
  );
  // Plain avatar: static span. With a drag handle it becomes a real button —
  // same reorder-grip pattern as the workspace sidebar.
  if (!dragHandle) return <span className="shrink-0">{avatar}</span>;
  return (
    <button
      type="button"
      aria-label={dragHandle.label}
      title={dragHandle.label}
      {...(dragHandle.props ?? {})}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 cursor-grab touch-none">
      {avatar}
    </button>
  );
}

/** One custom channel: click to activate, ⋯ menu for the rest. */
function ChannelRow({
  engine,
  entry,
  current,
  health,
  busy,
  drag,
  onToggle,
  onEdit,
  onDelete,
  onTest,
}: {
  engine: EngineId;
  entry: ProviderEntry;
  current: boolean;
  health: Health;
  busy: boolean;
  drag: RepoDragChrome | null;
  /** on=true → make current; on=false (only possible when current) → fall back to 官方配置. */
  onToggle: (on: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const fromCcSwitch = (entry.raw as Record<string, unknown>).source === "cc-switch";
  const subtitle = useMemo(() => {
    const parts = [
      entry.remark,
      entry.baseUrl && hostOf(entry.baseUrl),
      entry.model,
      health.state === "ok"
        ? `${health.ms}ms`
        : health.state === "fail"
          ? t("settings.cliTestFail")
          : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }, [entry.remark, entry.baseUrl, entry.model, health, t]);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cx(ROW, "cursor-pointer")}
      onClick={() => {
        if (!busy && !current) onToggle(true);
      }}
      onKeyDown={(e) => {
        // Ignore keys from nested controls (switch, edit, …): they handle
        // their own Enter/Space and must not also activate the row.
        if (e.target !== e.currentTarget) return;
        if ((e.key === "Enter" || e.key === " ") && !busy && !current) {
          e.preventDefault();
          onToggle(true);
        }
      }}
    >
      <ChannelAvatar
        entry={entry}
        fallbackEngine={engine}
        // The avatar doubles as the drag handle: stopPropagation keeps a
        // plain click (or the click after a drop) from activating the row.
        dragHandle={
          drag
            ? {
                label: t("settings.cliDrag"),
                props: drag.dragHandleProps,
              }
            : undefined
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1.5 text-body-regular text-text-primary">
          <span className="truncate">{entry.name}</span>
          {fromCcSwitch && <Badge tone="warning">cc-switch</Badge>}
        </p>
        {subtitle && (
          <p className="truncate text-body-2-regular text-text-secondary">{subtitle}</p>
        )}
      </div>
      {/* stopPropagation: action clicks must not re-activate the row.
          Order mirrors the reference: switch → divider → edit → delete. */}
      <span onClick={(e) => e.stopPropagation()}>
        <Switch
          size="sm"
          aria-label={entry.name}
          isSelected={current}
          onChange={onToggle}
          isDisabled={busy}
        />
      </span>
      <span
        aria-hidden
        className="h-4 w-px shrink-0 bg-separator-border"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        aria-label={t("settings.cliEdit")}
        title={t("settings.cliEdit")}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:opacity-40"
      >
        <Pencil className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t("settings.cliDelete")}
        title={t("settings.cliDelete")}
        disabled={busy || current}
        onClick={(e) => {
          e.stopPropagation();
          if (!current) onDelete();
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-text-error-primary disabled:opacity-40"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
      <span onClick={(e) => e.stopPropagation()}>
        <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownTrigger
            aria-label={t("settings.cliMore")}
            className="flex size-7 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover"
          >
            <EllipsisVertical className="size-4" aria-hidden />
          </DropdownTrigger>
          <DropdownPopover aria-label={entry.name} placement="bottom end" className="w-44">
            {!current && (
              <DropdownItem
                className="px-2 py-1.5"
                onSelect={() => {
                  setMenuOpen(false);
                  onToggle(true);
                }}
              >
                {t("settings.cliSetCurrent")}
              </DropdownItem>
            )}
            <DropdownItem
              className="px-2 py-1.5"
              onSelect={() => {
                setMenuOpen(false);
                onTest();
              }}
            >
              {health.state === "testing" ? t("settings.cliTesting") : t("settings.cliTest")}
            </DropdownItem>
          </DropdownPopover>
        </Dropdown>
      </span>
    </div>
  );
}

export function CliConfigSection() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CliConfig | null>(null);
  const [engine, setEngine] = useState<EngineId>("claude");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Add (no entry) or edit (with entry) dialog state. */
  const [dialog, setDialog] = useState<{ entry?: ProviderEntry } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderEntry | null>(null);
  const [ccStatus, setCcStatus] = useState<CcSwitchStatus | null>(null);
  /** Per-channel connection probe results, keyed `${engine}:${id}`. */
  const [health, setHealth] = useState<Record<string, Health>>({});
  useEffect(() => {
    let cancelled = false;
    ipc
      .getCliConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    ipc
      .checkCcSwitch()
      .then((s) => {
        if (!cancelled && s.installed) setCcStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Mutations go through one funnel: run → tell the chat tree → re-read.
  // Re-reading after each write keeps the UI on the backend's persisted
  // state (map order, current) instead of drifting on optimistic copies.
  const mutate = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await fn();
      notifyCliConfigChanged();
      setConfig(await ipc.getCliConfig());
      setError(null);
      return result;
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const section = config?.[engine];
  // Unset current behaves as 官方配置 (resolve_provider_env: empty → no injection).
  const currentId = section?.current || PSEUDO_LOCAL;
  const enabled = currentId !== PSEUDO_DISABLED;
  const entries = useMemo(() => providerEntries(engine, section), [engine, section]);

  const activate = (id: string) => {
    if (id !== currentId) void mutate(() => ipc.setCurrentProvider(engine, id));
  };

  const saveProvider = (value: ProviderFormValue) => {
    // stripConventionEnv keeps unknown fields (source, customModels, …), so
    // editing a cc-switch-imported channel preserves its origin marker.
    const base = dialog?.entry ? stripConventionEnv(engine, dialog.entry.raw) : {};
    const next: Record<string, unknown> = { ...base };
    for (const [key, val] of Object.entries({ ...value })) {
      const trimmed = val.trim();
      if (trimmed) next[key] = trimmed;
      else delete next[key];
    }
    const id = dialog?.entry?.id ?? crypto.randomUUID();
    setDialog(null);
    void mutate(() => ipc.upsertProvider(engine, id, next));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    void mutate(() => ipc.deleteProvider(engine, id));
  };

  const testConnection = async (entry: ProviderEntry) => {
    const key = `${engine}:${entry.id}`;
    if (!entry.baseUrl.trim()) {
      setHealth((h) => ({ ...h, [key]: { state: "fail" } }));
      return;
    }
    setHealth((h) => ({ ...h, [key]: { state: "testing" } }));
    try {
      const ms = await ipc.testProviderConnection(entry.baseUrl);
      setHealth((h) => ({ ...h, [key]: { state: "ok", ms } }));
    } catch {
      setHealth((h) => ({ ...h, [key]: { state: "fail" } }));
    }
  };

  /** Shared import→notice funnel. `target` is an engine id or "all" (banner).
   *  setState happens in the handler, not inside the `mutate` callback (React
   *  treats updater-style callbacks as pure and may invoke them twice). */
  const syncCcSwitch = async (target: string) => {
    const r = await mutate(() => ipc.importCcSwitch(target));
    if (!r) return;
    setCcStatus((s) => (s ? { ...s, changed: false } : s));
    setNotice(
      t("settings.cliSynced", {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
      }),
    );
  };

  const importCcSwitchFile = async () => {
    const path = await pickFile(t("settings.cliImportFile"), [
      { name: "cc-switch", extensions: ["db", "json"] },
    ]);
    if (!path) return;
    const r = await mutate(() => ipc.importCcSwitchFromPath(path, engine));
    if (!r) return;
    setNotice(
      t("settings.cliSynced", {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
      }),
    );
  };

  const dismissCcSwitch = () => {
    if (!ccStatus) return;
    void ipc.dismissCcSwitch(ccStatus.hash).catch(() => {});
    setCcStatus({ ...ccStatus, changed: false });
  };

  const officialActive = currentId === PSEUDO_LOCAL;

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body-regular text-text-secondary">
          {notice}
        </p>
      )}
      {!config && !error && (
        <p className="text-body-regular text-text-tertiary">{t("common.loading")}</p>
      )}
      {config && (
        <>
          <SortableEngineTabs engine={engine} onSelect={setEngine} />

          {ccStatus?.changed && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-button-default bg-background-secondary-default px-4 py-2.5">
              <p className="flex items-center gap-2 text-body-regular text-text-primary">
                <RefreshCw className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <span>
                  {t("settings.cliSyncTitle")}
                  <span className="text-text-secondary">
                    {" · "}
                    {t("settings.cliSyncDetail", { count: ccStatus.providers })}
                  </span>
                </span>
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void syncCcSwitch("all")}
                  className="rounded-lg bg-accent-500 px-3 py-1 text-body-2-medium text-white disabled:opacity-50"
                >
                  {t("settings.cliSyncNow")}
                </button>
                <button
                  type="button"
                  onClick={dismissCcSwitch}
                  className="rounded-lg border border-border-button-default px-3 py-1 text-body-2-medium text-text-primary"
                >
                  {t("settings.cliSyncLater")}
                </button>
              </div>
            </div>
          )}

          <div className="flex w-full flex-col gap-2">
            <SettingsSectionLabel>{t("settings.cliEngineSection")}</SettingsSectionLabel>
            <SettingsCard>
              <div className={ROW}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="text-body-regular text-text-primary">
                    {t("settings.cliEnableTitle", { name: CLI_DISPLAY_NAMES[engine] })}
                  </p>
                  <p className="text-body-2-regular text-text-secondary">
                    {t("settings.cliEnableDesc")}
                  </p>
                </div>
                <Switch
                  size="sm"
                  aria-label={t("settings.cliEnableTitle", { name: CLI_DISPLAY_NAMES[engine] })}
                  isSelected={enabled}
                  onChange={(on) => void mutate(() => ipc.setEngineEnabled(engine, on))}
                  isDisabled={busy}
                />
              </div>
              {/* Built-in fallback row: the CLI's own config file. Radio-style:
                  it can be turned on, never off. */}
              <div
                role="button"
                tabIndex={0}
                className={cx(ROW, "cursor-pointer")}
                onClick={() => !busy && activate(PSEUDO_LOCAL)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if ((e.key === "Enter" || e.key === " ") && !busy) {
                    e.preventDefault();
                    activate(PSEUDO_LOCAL);
                  }
                }}
              >
                <ChannelAvatar fallbackEngine={engine} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="flex items-center gap-1.5 text-body-regular text-text-primary">
                    <span className="truncate">{t("settings.cliOfficial")}</span>
                    <Badge>{t("settings.cliBuiltin")}</Badge>
                  </p>
                  <p className="truncate text-body-2-regular text-text-secondary">
                    {t("settings.cliOfficialDesc")}
                  </p>
                </div>
                <span onClick={(e) => e.stopPropagation()}>
                  <Switch
                    size="sm"
                    aria-label={t("settings.cliOfficial")}
                    isSelected={officialActive}
                    onChange={(on) => {
                      if (on) activate(PSEUDO_LOCAL);
                    }}
                    isDisabled={busy}
                  />
                </span>
              </div>
            </SettingsCard>
          </div>

          {(engine === "pi" || engine === "omp") && <PiFamilyAuthSection engine={engine} />}

          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <SettingsSectionLabel>
                {t("settings.cliChannels")}
                <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
                  {t("settings.cliChannelsHint")}
                </span>
              </SettingsSectionLabel>
              <div className="flex shrink-0 items-center gap-2">
                {CCS_IMPORT_ENGINES.includes(engine) && (
                  <Dropdown>
                    <DropdownTrigger
                      aria-label={t("settings.cliImportEntry")}
                      isDisabled={busy}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1.5 text-body-medium text-text-primary shadow-xs hover:bg-background-primary-hover hover:border-border-button-hover disabled:opacity-50"
                    >
                      <Download className="size-[18px] shrink-0" aria-hidden />
                      <span className="inline-flex items-center px-0.5">
                        {t("settings.cliImportEntry")}
                      </span>
                    </DropdownTrigger>
                    <DropdownPopover
                      aria-label={t("settings.cliImportEntry")}
                      placement="bottom end"
                      className="w-64"
                    >
                      <DropdownItem
                        className="px-2 py-1.5"
                        onSelect={() => void syncCcSwitch(engine)}
                      >
                        <ArrowLeftRight
                          className="size-4 shrink-0 text-foreground-icon-secondary"
                          aria-hidden
                        />
                        {t("settings.cliImportAuto")}
                      </DropdownItem>
                      <DropdownItem
                        className="px-2 py-1.5"
                        onSelect={() => void importCcSwitchFile()}
                      >
                        <FileText
                          className="size-4 shrink-0 text-foreground-icon-secondary"
                          aria-hidden
                        />
                        {t("settings.cliImportFile")}
                      </DropdownItem>
                    </DropdownPopover>
                  </Dropdown>
                )}
                <Button
                  size="small"
                  leadingIcon={Plus}
                  disabled={busy}
                  onClick={() => setDialog({})}
                >
                  {t("settings.cliDialogAdd")}
                </Button>
              </div>
            </div>

            <div className="relative">
              <SettingsCard>
                <WorkspaceSortableList
                  items={entries}
                  onReorder={(ids) => void mutate(() => ipc.reorderProviders(engine, ids))}
                  renderItem={(entry, drag) => (
                    <ChannelRow
                      engine={engine}
                      entry={entry}
                      current={currentId === entry.id}
                      health={health[`${engine}:${entry.id}`] ?? { state: "idle" }}
                      busy={busy}
                      drag={drag}
                      onToggle={(on) => activate(on ? entry.id : PSEUDO_LOCAL)}
                      onEdit={() => setDialog({ entry })}
                      onDelete={() => setPendingDelete(entry)}
                      onTest={() => void testConnection(entry)}
                    />
                  )}
                />
              </SettingsCard>

              {entries.length === 0 && (
                <div className="mt-3 rounded-2xl border border-dashed border-border-button-default px-4 py-6 text-center">
                  <p className="text-body-medium text-text-primary">
                    {t("settings.cliEmptyTitle")}
                  </p>
                  <p className="mt-1 text-body-2-regular text-text-secondary">
                    {t("settings.cliEmptyDesc")}
                  </p>
                </div>
              )}

              {!enabled && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background-primary-default/70 backdrop-blur-[1px]">
                  <p className="rounded-xl border border-border-button-default bg-background-primary-default px-4 py-2 text-body-2-medium text-text-secondary shadow-sm">
                    {t("settings.cliDisabledOverlay")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {dialog && (
        <ProviderDialog
          engine={engine}
          title={
            dialog.entry
              ? t("settings.cliDialogEdit")
              : t("settings.cliDialogAddEngine", { name: CLI_DISPLAY_NAMES[engine] })
          }
          initial={
            dialog.entry
              ? {
                  name: dialog.entry.name,
                  remark: dialog.entry.remark,
                  baseUrl: dialog.entry.baseUrl,
                  apiKey: dialog.entry.apiKey,
                  model: dialog.entry.model,
                }
              : undefined
          }
          onSubmit={saveProvider}
          onCancel={() => setDialog(null)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          danger
          message={t("settings.cliDeleteConfirm", { name: pendingDelete.name })}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
