import { useTranslation } from "react-i18next";
import { Switch } from "@/components/base/switch/switch";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { cx } from "@/utils/cx";
import type { EngineId } from "./providers";
import { Badge, ChannelAvatar, ROW } from "./CliChannelRow";

/** 引擎设置 card: the per-CLI enable switch plus the 官方配置 fallback row. */
export function CliEngineCard({
  engine,
  enabled,
  officialActive,
  busy,
  onToggleEnabled,
  onActivateOfficial,
}: {
  engine: EngineId;
  enabled: boolean;
  officialActive: boolean;
  busy: boolean;
  onToggleEnabled: (on: boolean) => void;
  onActivateOfficial: () => void;
}) {
  const { t } = useTranslation();
  return (
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
            onChange={onToggleEnabled}
            isDisabled={busy}
          />
        </div>
        {/* Built-in fallback row: the CLI's own config file. Radio-style:
            it can be turned on, never off. */}
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
    </div>
  );
}
