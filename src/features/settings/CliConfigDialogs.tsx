import { ConfirmDialog } from "@/components/dialogs";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ProviderDialog } from "./ProviderDialog";
import {
  PSEUDO_LOCAL,
  claudeSettingsJson,
  codexAuthJson,
  codexConfigToml,
} from "./providers";
import type { CliConfigState } from "./useCliConfig";

/** Add/edit provider dialog; the stored settingsConfig becomes the initial
 *  editor text for claude (settings.json) and codex (config.toml/auth.json). */
export function CliProviderDialog({ cli }: { cli: CliConfigState }) {
  const { t, engine, dialog, setDialog, saveProvider } = cli;
  if (!dialog) return null;
  return (
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
              settingsJson: engine === "claude" ? claudeSettingsJson(dialog.entry.raw) : "",
              configToml: engine === "codex" ? codexConfigToml(dialog.entry.raw) : "",
              authJson: engine === "codex" ? codexAuthJson(dialog.entry.raw) : "",
            }
          : undefined
      }
      onSubmit={saveProvider}
      onCancel={() => setDialog(null)}
    />
  );
}

/** Channel deletion confirmation. */
export function CliDeleteConfirm({ cli }: { cli: CliConfigState }) {
  const { t, pendingDelete, setPendingDelete, confirmDelete } = cli;
  if (!pendingDelete) return null;
  return (
    <ConfirmDialog
      danger
      message={t("settings.cliDeleteConfirm", { name: pendingDelete.name })}
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
  );
}

/** Channel switch confirmation, listing the native config files the switch
 *  would rewrite. */
export function CliSwitchConfirm({ cli }: { cli: CliConfigState }) {
  const { t, pendingSwitch, setPendingSwitch, entries, confirmSwitch } = cli;
  if (!pendingSwitch) return null;
  return (
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
  );
}
