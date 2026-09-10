import { useTranslation } from "react-i18next";
import Info from "lucide-react/dist/esm/icons/info";
import { Switch } from "@/components/base/switch/switch";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { SettingsCard } from "@/components/application/settings/settings-rows";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { cx } from "@/utils/cx";
import type { EngineId } from "./providers";
import { Badge, ChannelAvatar, ROW } from "./CliChannelRow";

/** 引擎设置 card: the per-CLI enable switch. Everything below this switch
 *  (official fallback, auth, channels) lives in CliConfigBody's overlay
 *  wrapper so disabling the engine masks all of it. */
export function CliEngineCard({
  engine,
  enabled,
  busy,
  onToggleEnabled,
}: {
  engine: EngineId;
  enabled: boolean;
  busy: boolean;
  onToggleEnabled: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsCard>
      <div className={ROW}>
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex items-center gap-1.5 text-body-regular text-text-primary">
            {t("settings.cliEnableTitle", { name: CLI_DISPLAY_NAMES[engine] })}
            <Badge>{t("settings.cliEngineSection")}</Badge>
            <Tooltip>
              <button
                type="button"
                aria-label={t("settings.cliEnableDesc")}
                className="inline-flex shrink-0 cursor-help items-center justify-center text-foreground-icon-quaternary transition-colors hover:text-text-secondary"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
              <TooltipContent>{t("settings.cliEnableDesc")}</TooltipContent>
            </Tooltip>
          </p>
        </div>
        <Switch
          size="sm"
          aria-label={t("settings.cliEnableTitle", { name: CLI_DISPLAY_NAMES[engine] })}
          isSelected={enabled}
          onChange={onToggleEnabled}
          isDisabled={busy}
        />
      </div>
    </SettingsCard>
  );
}

/** 官方配置 fallback row: the CLI's own config file. Radio-style: it can be
 *  turned on, never off. Rendered below the enable switch so the disabled
 *  overlay covers it too. */
export function CliOfficialCard({
  engine,
  officialActive,
  busy,
  onActivateOfficial,
}: {
  engine: EngineId;
  officialActive: boolean;
  busy: boolean;
  onActivateOfficial: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsCard>
      <div
        role="button"
        tabIndex={0}
        className={cx(ROW, "cursor-pointer")}
        onClick={() => !busy && onActivateOfficial()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            onActivateOfficial();
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
              if (on) onActivateOfficial();
            }}
            isDisabled={busy}
          />
        </span>
      </div>
    </SettingsCard>
  );
}
