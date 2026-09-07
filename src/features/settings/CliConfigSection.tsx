import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ConfirmDialog } from "@/components/dialogs";
import { ProviderDialog } from "./ProviderDialog";
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
