import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ConfirmDialog } from "@/components/dialogs";
import { ProviderDialog } from "./ProviderDialog";
import {
  PSEUDO_LOCAL,
  claudeSettingsJson,
  codexAuthJson,
  codexConfigToml,
} from "./providers";
import { CliConfigBody } from "./CliConfigBody";
import { useCliConfig } from "./useCliConfig";

/**
 * CLI 配置 page — the BoardUI ai-chat "Tools" template language:
 *   pill tabs (one per CLI, drag to reorder — SortableEngineTabs)
 *   → 引擎设置 card (enable switch + 官方配置 row)
 *   → 供应商渠道 card (avatar/switch/⋯-menu rows + drag sorting)
 *   → empty state.
 *
 * State and mutations live in useCliConfig; the loaded UI is CliConfigBody.
 */
export function CliConfigSection() {
  const cli = useCliConfig();
  const {
    t,
    config,
    engine,
    error,
    notice,
    dialog,
    setDialog,
    pendingDelete,
    setPendingDelete,
    pendingSwitch,
    setPendingSwitch,
    entries,
    confirmSwitch,
    saveProvider,
    confirmDelete,
  } = cli;
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
      {config && <CliConfigBody cli={cli} />}
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
                  settingsJson:
                    engine === "claude" ? claudeSettingsJson(dialog.entry.raw) : "",
                  configToml: engine === "codex" ? codexConfigToml(dialog.entry.raw) : "",
                  authJson: engine === "codex" ? codexAuthJson(dialog.entry.raw) : "",
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
      {pendingSwitch && (
        <ConfirmDialog
          message={t("settings.cliSwitchConfirm", {
            name:
              pendingSwitch.id === PSEUDO_LOCAL
                ? t("settings.cliOfficial")
                : (entries.find((e) => e.id === pendingSwitch.id)?.name ?? pendingSwitch.id),
          })}
          onConfirm={confirmSwitch}
          onCancel={() => setPendingSwitch(null)}
        >
          <ul className="mt-2 flex flex-col gap-1">
            {pendingSwitch.paths.map((path) => (
              <li
                key={path}
                className="break-all rounded-lg bg-background-secondary-default px-2 py-1 font-mono text-body-2-regular text-text-secondary"
              >
                {path}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-body-2-regular text-text-tertiary">
            {t("settings.cliSwitchConfirmHint")}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
