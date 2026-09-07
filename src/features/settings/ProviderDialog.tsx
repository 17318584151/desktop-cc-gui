import { useState } from "react";
import { useTranslation } from "react-i18next";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Globe from "lucide-react/dist/esm/icons/globe";
import X from "lucide-react/dist/esm/icons/x";
import bailianIcon from "@lobehub/icons-static-svg/icons/bailian-color.svg";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg";
import longcatIcon from "@lobehub/icons-static-svg/icons/longcat-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import moonshotIcon from "@lobehub/icons-static-svg/icons/moonshot.svg";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import xaiIcon from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomimimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ModalShell } from "@/components/dialogs";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { cx } from "@/utils/cx";
import type { EngineId } from "./providers";

/** Editable channel fields. `raw` stays with the parent and is merged back
 *  on save so fields this form doesn't know (env, customModels, …) survive. */
export interface ProviderFormValue {
  name: string;
  remark: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ProviderPreset {
  /** Brand-literal display name (same convention as CLI_DISPLAY_NAMES). */
  name: string;
  baseUrl: string;
  model: string;
  /** Explicit provider mark; model inference is unsafe for relay presets
   *  whose default model belongs to a different brand (e.g. OpenCode Go). */
  iconSrc: string;
  /** Monochrome SVGs use currentColor, which stays black inside an <img>;
   *  invert them in dark mode so they remain visible. */
  iconClassName?: string;
}

/** Claude-only: the official direct endpoint. Selecting the official card
 *  locks API URL to this value, mirroring the reference's 官方直连 preset. */
const OFFICIAL_BASE_URL = "https://api.anthropic.com";
const DARK_MONO_ICON_CLASS = "dark:invert";

/** Third-party relay presets per engine (flat baseUrl/model shape — what the
 *  backend's env_mapping injects). Claude's table is ported from the
 *  reference's CLAUDE_PROVIDER_PRESETS, collapsed to one default model. */
const PRESETS: Partial<Record<EngineId, ProviderPreset[]>> = {
  claude: [
    { name: "智谱GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic", model: "glm-5.2", iconSrc: zhipuIcon },
    { name: "Kimi", baseUrl: "https://api.moonshot.cn/anthropic", model: "kimi-k3", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "Kimi Coding", baseUrl: "https://api.kimi.com/coding/", model: "kimi-k3", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-v4-pro[1m]", iconSrc: deepseekIcon },
    { name: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic", model: "MiniMax-M2.1", iconSrc: minimaxIcon },
    { name: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/anthropic", model: "mimo-v2.5-pro", iconSrc: xiaomimimoIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "Xiaomi MiMo Plan", baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic", model: "mimo-v2.5-pro", iconSrc: xiaomimimoIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "Bailian", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", model: "", iconSrc: bailianIcon },
    { name: "Bailian Coding", baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic", model: "", iconSrc: bailianIcon },
    { name: "LongCat", baseUrl: "https://api.longcat.chat/anthropic", model: "LongCat-2.0", iconSrc: longcatIcon },
    { name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go", model: "deepseek-v4-flash", iconSrc: opencodeIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api", model: "anthropic/claude-sonnet-4.5", iconSrc: openrouterIcon },
  ],
  kimi: [
    { name: "Kimi Coding", baseUrl: "https://api.kimi.com/coding/v1", model: "kimi-for-coding", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "", iconSrc: moonshotIcon, iconClassName: DARK_MONO_ICON_CLASS },
  ],
  grok: [{ name: "xAI Official", baseUrl: "https://api.x.ai/v1", model: "grok-build", iconSrc: xaiIcon, iconClassName: DARK_MONO_ICON_CLASS }],
  codex: [
    { name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-5.2", iconSrc: zhipuIcon },
    { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", iconSrc: deepseekIcon },
    { name: "MiniMax", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3", iconSrc: minimaxIcon },
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "", iconSrc: openrouterIcon },
  ],
};

interface ProviderDialogProps {
  engine: EngineId;
  title: string;
  initial?: ProviderFormValue;
  onSubmit: (value: ProviderFormValue) => void;
  onCancel: () => void;
}

/** Brand mark for a preset button: explicit per-preset assets keep relay
 *  providers distinct from the model they happen to serve by default. */
function PresetIcon({ preset }: { preset: ProviderPreset }) {
  return (
    <img
      src={preset.iconSrc}
      alt=""
      className={cx("size-3.5 object-contain", preset.iconClassName)}
      aria-hidden
    />
  );
}

/** A channel can be saved once it has a name and an endpoint. */
function isProviderFormValid(value: ProviderFormValue): boolean {
  return value.name.trim() !== "" && value.baseUrl.trim() !== "";
}

/** The preset matching the current URL; the empty 自定义 URL matches nothing. */
function findMatchedPreset(
  presets: ProviderPreset[],
  baseUrl: string,
): ProviderPreset | undefined {
  return presets.find((p) => p.baseUrl === baseUrl && p.baseUrl !== "");
}

/** Claude-only official direct-connection card; selecting it locks the API
 *  URL to Anthropic's endpoint. */
function OfficialPresetSection({
  official,
  onSelect,
}: {
  official: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-2-medium text-text-secondary">
        {t("settings.cliOfficialSection")}
      </p>
      <button
        type="button"
        aria-pressed={official}
        onClick={onSelect}
        className={cx(
          "flex w-full cursor-pointer items-center gap-3 rounded-2lg border p-3 text-left transition-colors",
          official
            ? "border-border-focus-ring bg-background-secondary-default"
            : "border-border-button-default hover:bg-background-secondary-hover",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-tertiary-default text-foreground-icon-primary">
          <EngineIcon engine="claude" size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-medium text-text-primary">
            {t("settings.cliOfficialPreset")}
          </span>
          <span className="text-body-2-regular text-text-secondary">
            {t("settings.cliOfficialPresetDesc")}
          </span>
        </span>
      </button>
    </div>
  );
}

/** Third-party relay preset grid, plus the 自定义配置 escape hatch that
 *  unlocks the URL without prefilling anything. */
function ProxyPresetSection({
  engine,
  presets,
  official,
  matchedPreset,
  onSelectCustom,
  onSelectPreset,
}: {
  engine: EngineId;
  presets: ProviderPreset[];
  official: boolean;
  matchedPreset: ProviderPreset | undefined;
  onSelectCustom: () => void;
  onSelectPreset: (preset: ProviderPreset) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-2-medium text-text-secondary">
        {t("settings.cliProxySection")}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {/* 自定义配置: pure escape hatch — unlocks the URL without
            prefilling anything. */}
        <button
          type="button"
          aria-pressed={!official && !matchedPreset}
          onClick={onSelectCustom}
          className={cx(
            "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-body-2-regular transition-colors",
            !official && !matchedPreset
              ? "border-border-focus-ring bg-background-secondary-default text-text-primary"
              : "border-border-button-default text-text-secondary hover:bg-background-secondary-hover",
          )}
        >
          <Globe className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("settings.cliPresetCustom")}</span>
        </button>
        {presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            aria-pressed={matchedPreset?.name === preset.name}
            onClick={() => onSelectPreset(preset)}
            className={cx(
              "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-body-2-regular transition-colors",
              matchedPreset?.name === preset.name
                ? "border-border-focus-ring bg-background-secondary-default text-text-primary"
                : "border-border-button-default text-text-secondary hover:bg-background-secondary-hover",
            )}
          >
            <span className="shrink-0 text-foreground-icon-secondary">
              <PresetIcon preset={preset} />
            </span>
            <span className="truncate">{preset.name}</span>
          </button>
        ))}
      </div>
      {engine === "claude" && (
        <p className="text-body-2-regular text-text-tertiary">
          {t("settings.cliProxyHint")}
        </p>
      )}
    </div>
  );
}

/** Add/edit one channel. The official card (Claude only) locks the URL to
 *  Anthropic's endpoint; preset buttons prefill name/URL/model and the fields
 *  stay editable afterwards (preset = starting point, not a mode). */
export function ProviderDialog({ engine, title, initial, onSubmit, onCancel }: ProviderDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState<ProviderFormValue>(
    initial ?? { name: "", remark: "", baseUrl: "", apiKey: "", model: "" },
  );
  const [showKey, setShowKey] = useState(false);
  const presets = PRESETS[engine] ?? [];
  const official = engine === "claude" && value.baseUrl === OFFICIAL_BASE_URL;
  const matchedPreset = findMatchedPreset(presets, value.baseUrl);

  const selectPreset = (preset: ProviderPreset) => {
    setValue((v) => ({ ...v, name: preset.name, baseUrl: preset.baseUrl, model: preset.model }));
  };

  const patch = (p: Partial<ProviderFormValue>) => setValue((v) => ({ ...v, ...p }));
  const valid = isProviderFormValid(value);

  return (
    <ModalShell onClose={onCancel} className="w-[560px] max-w-[calc(100vw-32px)] p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-title-3-medium text-text-primary">{title}</p>
        <button
          type="button"
          aria-label={t("common.cancel")}
          onClick={onCancel}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliDialogNote")}
      </p>
      <form
        className="mt-5 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(value);
        }}
      >
        {engine === "claude" && (
          <OfficialPresetSection
            official={official}
            onSelect={() => patch({ baseUrl: OFFICIAL_BASE_URL })}
          />
        )}

        {presets.length > 0 && (
          <ProxyPresetSection
            engine={engine}
            presets={presets}
            official={official}
            matchedPreset={matchedPreset}
            onSelectCustom={() => patch({ baseUrl: "" })}
            onSelectPreset={selectPreset}
          />
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label={t("settings.cliName")}
            isRequired
            size="small"
            placeholder={t("settings.cliNamePlaceholder")}
            value={value.name}
            onChange={(name) => patch({ name })}
            autoFocus
          />
          <Input
            label={t("settings.cliRemark")}
            size="small"
            placeholder={t("settings.cliRemarkPlaceholder")}
            value={value.remark}
            onChange={(remark) => patch({ remark })}
          />
          <Input
            label={t("settings.cliBaseUrl")}
            isRequired
            size="small"
            placeholder="https://…"
            value={value.baseUrl}
            onChange={(baseUrl) => patch({ baseUrl })}
            isDisabled={official}
          />
          <div className="relative">
            <Input
              label={t("settings.cliApiKey")}
              isRequired
              size="small"
              type={showKey ? "text" : "password"}
              placeholder={engine === "claude" ? "sk-ant-..." : "…"}
              value={value.apiKey}
              onChange={(apiKey) => patch({ apiKey })}
              fieldClassName="pr-8"
            />
            <button
              type="button"
              aria-label={showKey ? t("settings.cliApiKey") : t("settings.cliApiKey")}
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 bottom-1.5 flex size-5 items-center justify-center rounded text-foreground-icon-tertiary hover:text-foreground-icon-primary"
            >
              {showKey ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </button>
          </div>
          <Input
            label={t("settings.cliModel")}
            size="small"
            value={value.model}
            onChange={(model) => patch({ model })}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="small" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="small" disabled={!valid}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
