import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Ban from "lucide-react/dist/esm/icons/ban";
import Globe from "lucide-react/dist/esm/icons/globe";
import GripVertical from "lucide-react/dist/esm/icons/grip-vertical";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Switch } from "@/components/base/switch/switch";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { WorkspaceSortableList } from "@/components/application/ai-chat/workspace-sortable-list";
import { ConfirmDialog } from "@/components/dialogs";
import {
  CLI_DISPLAY_NAMES,
  EngineIcon,
  inferModelEngine,
} from "@/components/foundations/icons/engine-icon";
import { ipc, type CliConfig } from "@/lib/ipc";
import {
  ENGINE_IDS,
  PSEUDO_DISABLED,
  PSEUDO_LOCAL,
  notifyCliConfigChanged,
  providerEntries,
  stripConventionEnv,
  type EngineId,
  type ProviderEntry,
} from "./providers";
import { ProviderDialog, type ProviderFormValue } from "./ProviderDialog";

/** Same chrome as SettingsRow's container, but free-form content (drag
 *  handle + icon + name + controls instead of label/control). */
const ROW =
  "flex min-h-[52px] w-full items-center gap-2 py-2.5 pr-2.5 border-b border-separator-border last:border-b-0";

/** Channel brand mark: inferred from the model id, then the baseUrl host
 *  (e.g. api.moonshot.cn → kimi); globe when neither matches. */
function BrandIcon({ entry }: { entry: ProviderEntry }) {
  const brand = inferModelEngine(entry.model) ?? inferModelEngine(entry.baseUrl);
  return brand ? (
    <EngineIcon engine={brand} size={16} className="shrink-0 text-foreground-icon-primary" />
  ) : (
    <Globe className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
  );
}

/** Pinned non-channel rows: 官方配置 (CLI's own config file) and 停用. */
function PseudoRow({
  icon,
  label,
  description,
  active,
  disabled,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  active: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <div className={ROW}>
      <span className="flex size-4 shrink-0 items-center justify-center text-foreground-icon-secondary">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-body-regular text-text-primary">{label}</p>
        <p className="text-body-2-regular text-text-secondary">{description}</p>
      </div>
      <Switch
        size="sm"
        aria-label={label}
        isSelected={active}
        onChange={onToggle}
        isDisabled={disabled}
      />
    </div>
  );
}

/**
 * CLI 配置 page: engine pill tabs + the channel list of the selected engine.
 * Single-select semantics — the backend injects exactly one provider's env;
 * turning a row on makes it current, turning the current row off falls back
 * to 官方配置 (PSEUDO_LOCAL).
 */
export function CliConfigSection() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CliConfig | null>(null);
  const [engine, setEngine] = useState<EngineId>("claude");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Add (no entry) or edit (with entry) dialog state. */
  const [dialog, setDialog] = useState<{ entry?: ProviderEntry } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderEntry | null>(null);

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
    return () => {
      cancelled = true;
    };
  }, []);

  // Mutations go through one funnel: run → tell the chat tree → re-read.
  // Re-reading after each write keeps the UI on the backend's persisted
  // state (map order, current) instead of drifting on optimistic copies.
  const mutate = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      notifyCliConfigChanged();
      setConfig(await ipc.getCliConfig());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const section = config?.[engine];
  // Unset current behaves as 官方配置 (resolve_provider_env: empty → no injection).
  const currentId = section?.current || PSEUDO_LOCAL;
  const entries = useMemo(() => providerEntries(engine, section), [engine, section]);

  const onToggle = (id: string, on: boolean) => {
    if (on) void mutate(() => ipc.setCurrentProvider(engine, id));
    else if (currentId === id) void mutate(() => ipc.setCurrentProvider(engine, PSEUDO_LOCAL));
  };

  const saveProvider = (value: ProviderFormValue) => {
    const base = dialog?.entry ? stripConventionEnv(engine, dialog.entry.raw) : {};
    const next: Record<string, unknown> = { ...base };
    const fields: Record<string, string> = { ...value };
    for (const [key, val] of Object.entries(fields)) {
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

  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
      {!config && !error && (
        <p className="text-body-regular text-text-tertiary">{t("common.loading")}</p>
      )}
      {config && (
        <>
          <PillTabList className="flex-wrap">
            {ENGINE_IDS.map((id) => (
              <PillTab
                key={id}
                variant="gray"
                isSelected={engine === id}
                onSelect={() => setEngine(id)}
                icon={({ className }) => (
                  <EngineIcon engine={id} size={16} className={className} />
                )}
              >
                {CLI_DISPLAY_NAMES[id]}
              </PillTab>
            ))}
          </PillTabList>

          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-between">
              <SettingsSectionLabel>{t("settings.cliChannels")}</SettingsSectionLabel>
              <Button
                size="small"
                leadingIcon={Plus}
                disabled={busy}
                onClick={() => setDialog({})}
              >
                {t("settings.cliAdd")}
              </Button>
            </div>
            <SettingsCard>
              <PseudoRow
                icon={<EngineIcon engine={engine} size={16} />}
                label={t("settings.cliOfficial")}
                description={t("settings.cliOfficialDesc")}
                active={currentId === PSEUDO_LOCAL}
                disabled={busy}
                onToggle={(on) => onToggle(PSEUDO_LOCAL, on)}
              />
              <PseudoRow
                icon={<Ban className="size-4" aria-hidden />}
                label={t("settings.cliDisabled")}
                description={t("settings.cliDisabledDesc")}
                active={currentId === PSEUDO_DISABLED}
                disabled={busy}
                onToggle={(on) => onToggle(PSEUDO_DISABLED, on)}
              />
              <WorkspaceSortableList
                items={entries}
                onReorder={(ids) => void mutate(() => ipc.reorderProviders(engine, ids))}
                renderItem={(entry, drag) => (
                  <div className={ROW}>
                    {drag && (
                      <button
                        type="button"
                        aria-label={t("settings.cliDrag")}
                        {...drag.dragHandleProps}
                        className="shrink-0 cursor-grab touch-none text-foreground-icon-secondary"
                      >
                        <GripVertical className="size-4" aria-hidden />
                      </button>
                    )}
                    <BrandIcon entry={entry} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="truncate text-body-regular text-text-primary">{entry.name}</p>
                      {(entry.model || entry.baseUrl) && (
                        <p className="truncate text-body-2-regular text-text-secondary">
                          {entry.model || entry.baseUrl}
                        </p>
                      )}
                    </div>
                    <Switch
                      size="sm"
                      aria-label={entry.name}
                      isSelected={currentId === entry.id}
                      onChange={(on) => onToggle(entry.id, on)}
                      isDisabled={busy}
                    />
                    <IconButton
                      icon={Pencil}
                      size="small"
                      aria-label={t("settings.cliEdit")}
                      disabled={busy}
                      onClick={() => setDialog({ entry })}
                    />
                    <IconButton
                      icon={Trash2}
                      size="small"
                      aria-label={t("settings.cliDelete")}
                      disabled={busy}
                      onClick={() => setPendingDelete(entry)}
                    />
                  </div>
                )}
              />
              {entries.length === 0 && (
                <p className="py-2.5 pr-2.5 text-body-2-regular text-text-tertiary">
                  {t("settings.cliEmpty")}
                </p>
              )}
            </SettingsCard>
          </div>
        </>
      )}
      {dialog && (
        <ProviderDialog
          engine={engine}
          title={dialog.entry ? t("settings.cliDialogEdit") : t("settings.cliDialogAdd")}
          initial={
            dialog.entry
              ? {
                  name: dialog.entry.name,
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
