import { useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Cloud from "lucide-react/dist/esm/icons/cloud";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Globe from "lucide-react/dist/esm/icons/globe";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/input/textarea";
import { ModalShell } from "@/components/dialogs";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { ipc } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import type { EngineId } from "./providers";
import {
  CLAUDE_MODEL_SLOTS,
  DEFAULT_CODEX_AUTH_JSON,
  OFFICIAL_BASE_URL,
  OFFICIAL_CODEX_BASE_URL,
  OFFICIAL_CODEX_CONFIG_TOML,
  PRESETS,
  authJsonApiKey,
  buildCodexConfigToml,
  claudeTemplateJson,
  findMatchedPreset,
  isOfficialAnthropicEndpoint,
  tomlBaseUrl,
  tomlModel,
  type ClaudeModelSlot,
  type ProviderPreset,
} from "./providerPresets";

/**
 * Add/edit one provider channel, per engine:
 *   - claude: preset cards → name/remark/URL/key → 模型映射 (per-tier default
 *     models) → JSON 配置 editor. Fields and the JSON editor stay in sync
 *     both ways; the JSON is saved as the channel's settingsConfig.
 *   - codex: preset cards → name/remark → config.toml + auth.json editors
 *     (saved as settingsConfig.config / settingsConfig.auth; flat baseUrl/
 *     apiKey/model mirrors are extracted from them at submit for the row
 *     display and model picker).
 *   - kimi/grok/pi/omp/dsh: preset cards → flat name/remark/URL/key/model,
 *     with a 拉取模型 datalist on the model field.
 *
 * `raw` stays with the parent and is merged back on save so fields this form
 * doesn't know (source, customModels, …) survive.
 */
export interface ProviderFormValue {
  name: string;
  remark: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** claude: full settings.json text → stored as settingsConfig. */
  settingsJson: string;
  /** codex: config.toml text → stored as settingsConfig.config. */
  configToml: string;
  /** codex: auth.json text → stored as settingsConfig.auth. */
  authJson: string;
}

const EMPTY_FORM: ProviderFormValue = {
  name: "",
  remark: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  settingsJson: "",
  configToml: "",
  authJson: "",
};

const FETCH_DATALIST_ID = "cli-provider-fetched-models";
const EMPTY_SLOTS: Record<ClaudeModelSlot, string> = { fable: "", sonnet: "", opus: "", haiku: "" };

/** Initial form state per engine. Claude seeds the JSON editor from the
 *  stored settingsConfig (edit), the flat fields (legacy channels), or the
 *  official-direct template (add); codex seeds config.toml/auth.json the
 *  same way. */
function initialForm(engine: EngineId, initial?: ProviderFormValue): ProviderFormValue {
  const base: ProviderFormValue = { ...EMPTY_FORM, ...initial };
  if (engine === "claude") {
    if (base.settingsJson.trim()) return base;
    if (initial) {
      // Legacy flat channel: migrate its fields into the default template.
      const extra: Record<string, string> = {};
      if (base.model.trim()) extra.ANTHROPIC_MODEL = base.model.trim();
      return {
        ...base,
        settingsJson: claudeTemplateJson(base.baseUrl.trim(), base.apiKey.trim(), extra),
      };
    }
    // New channel: official direct selected, matching the reference dialog.
    return {
      ...base,
      baseUrl: OFFICIAL_BASE_URL,
      settingsJson: claudeTemplateJson(OFFICIAL_BASE_URL, ""),
    };
  }
  if (engine === "codex") {
    return {
      ...base,
      configToml: base.configToml.trim()
        ? base.configToml
        : initial
          ? buildCodexConfigToml(
              "ccgui",
              base.baseUrl.trim() || "https://api.example.com/v1",
              base.model.trim() || "gpt-5.1-codex",
              "chat",
            )
          : OFFICIAL_CODEX_CONFIG_TOML,
      authJson: base.authJson.trim() ? base.authJson : DEFAULT_CODEX_AUTH_JSON,
    };
  }
  return base;
}

/** Claude model-slot values parsed out of a settings.json text. */
function slotsFromJson(settingsJson: string): Record<ClaudeModelSlot, string> {
  try {
    const parsed: unknown = JSON.parse(settingsJson);
    const env = (parsed as Record<string, unknown> | null)?.env;
    if (!env || typeof env !== "object") return { ...EMPTY_SLOTS };
    const read = (key: string) => {
      const v = (env as Record<string, unknown>)[key];
      return typeof v === "string" ? v : "";
    };
    return {
      fable: read("ANTHROPIC_DEFAULT_FABLE_MODEL"),
      sonnet: read("ANTHROPIC_DEFAULT_SONNET_MODEL"),
      opus: read("ANTHROPIC_DEFAULT_OPUS_MODEL"),
      haiku: read("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    };
  } catch {
    return { ...EMPTY_SLOTS };
  }
}

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

/** Official direct-connection card (claude/codex); selecting it pins the
 *  channel to the vendor's own endpoint. */
function OfficialPresetSection({
  engine,
  official,
  onSelect,
}: {
  engine: EngineId;
  official: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isClaude = engine === "claude";
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
          <EngineIcon engine={engine} size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-medium text-text-primary">
            {isClaude ? t("settings.cliOfficialPreset") : t("settings.cliCodexOfficialPreset")}
          </span>
          <span className="text-body-2-regular text-text-secondary">
            {isClaude
              ? t("settings.cliOfficialPresetDesc")
              : t("settings.cliCodexOfficialPresetDesc")}
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

/** 拉取模型 button plus its result/error readout; the fetched ids feed the
 *  shared datalist behind the model inputs. */
function FetchModelsControl({
  fetching,
  error,
  count,
  disabled,
  onFetch,
}: {
  fetching: boolean;
  error: string;
  count: number;
  disabled: boolean;
  onFetch: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onFetch}
        disabled={fetching || disabled}
        className="shrink-0 rounded-lg border border-border-button-default px-2 py-0.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-secondary-hover disabled:opacity-50"
      >
        {fetching ? t("settings.cliFetchModelsLoading") : t("settings.cliFetchModels")}
      </button>
      {error ? (
        <span className="text-body-2-regular text-text-error-primary">{error}</span>
      ) : count > 0 ? (
        <span className="text-body-2-regular text-text-tertiary">
          {t("settings.cliFetchModelsCount", { count })}
        </span>
      ) : null}
    </div>
  );
}

export function ProviderDialog({ engine, title, initial, onSubmit, onCancel }: ProviderDialogProps) {
  const { t } = useTranslation();
  const isClaude = engine === "claude";
  const isCodex = engine === "codex";
  const [value, setValue] = useState<ProviderFormValue>(() => initialForm(engine, initial));
  // Model slots start empty on add (the template's env carries the defaults,
  // same as the reference); on edit they mirror the stored settings.json.
  const [slots, setSlots] = useState<Record<ClaudeModelSlot, string>>(() =>
    isClaude && initial?.settingsJson ? slotsFromJson(initial.settingsJson) : { ...EMPTY_SLOTS },
  );
  const [showKey, setShowKey] = useState(false);
  const [jsonError, setJsonError] = useState("");
  const [authError, setAuthError] = useState("");
  const [jsonOpen, setJsonOpen] = useState(true);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const presets = PRESETS[engine] ?? [];
  const patch = (p: Partial<ProviderFormValue>) => setValue((v) => ({ ...v, ...p }));

  // ── claude JSON <-> field sync ────────────────────────────────────────────

  /** Write one env key into the JSON editor's text. A text the user broke
   *  (invalid JSON) is left untouched — the editor error is already shown. */
  const updateClaudeEnv = (key: string, val: string) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = value.settingsJson ? (JSON.parse(value.settingsJson) as Record<string, unknown>) : {};
    } catch {
      return;
    }
    const prevEnv = (parsed.env ?? {}) as Record<string, unknown>;
    const nextEnv = { ...prevEnv };
    if (val.trim()) nextEnv[key] = val;
    else delete nextEnv[key];
    const next =
      Object.keys(nextEnv).length > 0
        ? { ...parsed, env: nextEnv }
        : Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== "env"));
    patch({ settingsJson: JSON.stringify(next, null, 2) });
    setJsonError("");
  };

  const onJsonChange = (text: string) => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const env = (parsed.env ?? {}) as Record<string, unknown>;
      const read = (key: string) => {
        const v = env[key];
        return typeof v === "string" ? v : "";
      };
      setSlots({
        fable: read("ANTHROPIC_DEFAULT_FABLE_MODEL"),
        sonnet: read("ANTHROPIC_DEFAULT_SONNET_MODEL"),
        opus: read("ANTHROPIC_DEFAULT_OPUS_MODEL"),
        haiku: read("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
      });
      setValue((v) => ({
        ...v,
        settingsJson: text,
        baseUrl: read("ANTHROPIC_BASE_URL"),
        apiKey: read("ANTHROPIC_AUTH_TOKEN") || read("ANTHROPIC_API_KEY"),
      }));
      setJsonError("");
    } catch {
      setValue((v) => ({ ...v, settingsJson: text }));
      setJsonError(t("settings.cliJsonError"));
    }
  };

  const handleFormatJson = () => {
    try {
      patch({ settingsJson: JSON.stringify(JSON.parse(value.settingsJson), null, 2) });
      setJsonError("");
    } catch {
      setJsonError(t("settings.cliJsonError"));
    }
  };

  const handleFormatAuthJson = () => {
    try {
      patch({ authJson: JSON.stringify(JSON.parse(value.authJson), null, 2) });
      setAuthError("");
    } catch {
      setAuthError(t("settings.cliAuthJsonError"));
    }
  };

  // ── presets ───────────────────────────────────────────────────────────────

  const selectPreset = (preset: ProviderPreset) => {
    if (isClaude) {
      const slotEnv = preset.env ?? {};
      setSlots({
        fable: slotEnv.ANTHROPIC_DEFAULT_FABLE_MODEL ?? "",
        sonnet: slotEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "",
        opus: slotEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "",
        haiku: slotEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "",
      });
      setValue((v) => ({
        ...v,
        name: preset.name,
        baseUrl: preset.baseUrl,
        settingsJson: claudeTemplateJson(preset.baseUrl, v.apiKey.trim(), slotEnv),
      }));
      setJsonError("");
    } else if (isCodex) {
      setValue((v) => ({
        ...v,
        name: preset.name,
        configToml: buildCodexConfigToml(
          preset.name,
          preset.baseUrl,
          preset.model || "gpt-5.1-codex",
          preset.wireApi ?? "chat",
        ),
      }));
    } else {
      setValue((v) => ({ ...v, name: preset.name, baseUrl: preset.baseUrl, model: preset.model }));
    }
    resetFetch();
  };

  const selectOfficial = () => {
    if (isClaude) {
      setSlots({ ...EMPTY_SLOTS });
      setValue((v) => ({
        ...v,
        baseUrl: OFFICIAL_BASE_URL,
        settingsJson: claudeTemplateJson(OFFICIAL_BASE_URL, v.apiKey.trim()),
      }));
      setJsonError("");
    } else if (isCodex) {
      patch({ configToml: OFFICIAL_CODEX_CONFIG_TOML });
    }
    resetFetch();
  };

  const selectCustom = () => {
    if (isClaude) {
      setSlots({ ...EMPTY_SLOTS });
      setValue((v) => ({
        ...v,
        baseUrl: "",
        settingsJson: claudeTemplateJson("", v.apiKey.trim()),
      }));
      setJsonError("");
    } else if (isCodex) {
      patch({
        configToml: buildCodexConfigToml(
          "custom",
          "https://api.example.com/v1",
          "gpt-5.1-codex",
          "responses",
        ),
      });
    } else {
      patch({ baseUrl: "" });
    }
    resetFetch();
  };

  // ── fetch models ──────────────────────────────────────────────────────────

  function resetFetch() {
    setFetchedModels([]);
    setFetchError("");
  }

  const handleFetchModels = async () => {
    const baseUrl = isCodex ? tomlBaseUrl(value.configToml) : value.baseUrl.trim();
    const apiKey = isCodex ? authJsonApiKey(value.authJson) : value.apiKey;
    if (!baseUrl) {
      setFetchError(t("settings.cliFetchModelsNeedUrl"));
      return;
    }
    setFetching(true);
    setFetchError("");
    try {
      const result = await ipc.fetchProviderModels(baseUrl, apiKey);
      setFetchedModels(result.models);
      if (result.models.length === 0) setFetchError(t("settings.cliFetchModelsEmpty"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setFetchError(message || t("settings.cliFetchModelsError"));
    } finally {
      setFetching(false);
    }
  };

  // ── validity & submit ─────────────────────────────────────────────────────

  const official = isClaude
    ? value.baseUrl === OFFICIAL_BASE_URL
    : isCodex
      ? tomlBaseUrl(value.configToml) === OFFICIAL_CODEX_BASE_URL
      : false;
  const matchedPreset = findMatchedPreset(
    presets,
    isCodex ? tomlBaseUrl(value.configToml) : value.baseUrl,
  );

  const jsonValid = (() => {
    if (!isClaude) return true;
    try {
      JSON.parse(value.settingsJson || "{}");
      return true;
    } catch {
      return false;
    }
  })();
  const authValid = (() => {
    if (!isCodex || !value.authJson.trim()) return true;
    try {
      JSON.parse(value.authJson);
      return true;
    } catch {
      return false;
    }
  })();
  const valid =
    value.name.trim() !== "" &&
    (isCodex ? value.configToml.trim() !== "" : value.baseUrl.trim() !== "") &&
    jsonValid &&
    authValid;

  const submit = () => {
    if (!valid) return;
    if (isCodex) {
      // Flat mirrors for the row display and model picker; the backend
      // applies the TOML/auth.json themselves.
      onSubmit({
        ...value,
        baseUrl: tomlBaseUrl(value.configToml),
        apiKey: authJsonApiKey(value.authJson),
        model: tomlModel(value.configToml),
      });
      return;
    }
    onSubmit(value);
  };

  const slotLabelKey = (slot: ClaudeModelSlot) =>
    `settings.cli${slot.charAt(0).toUpperCase()}${slot.slice(1)}Model`;

  return (
    <ModalShell
      onClose={onCancel}
      className="max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto p-6"
    >
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
          submit();
        }}
      >
        {(isClaude || isCodex) && (
          <OfficialPresetSection engine={engine} official={official} onSelect={selectOfficial} />
        )}

        {presets.length > 0 && (
          <ProxyPresetSection
            engine={engine}
            presets={presets}
            official={official}
            matchedPreset={matchedPreset}
            onSelectCustom={selectCustom}
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
          {!isCodex && (
            <Input
              label={t("settings.cliBaseUrl")}
              isRequired
              size="small"
              placeholder="https://…"
              value={value.baseUrl}
              onChange={(baseUrl) => {
                patch({ baseUrl });
                if (isClaude) updateClaudeEnv("ANTHROPIC_BASE_URL", baseUrl);
              }}
              isDisabled={official}
            />
          )}
          {!isCodex && (
            <div className="relative">
              <Input
                label={t("settings.cliApiKey")}
                isRequired
                size="small"
                type={showKey ? "text" : "password"}
                placeholder={isClaude ? "sk-ant-..." : "…"}
                value={value.apiKey}
                onChange={(apiKey) => {
                  patch({ apiKey });
                  if (isClaude) updateClaudeEnv("ANTHROPIC_AUTH_TOKEN", apiKey);
                }}
                fieldClassName="pr-8"
              />
              <button
                type="button"
                aria-label={t("settings.cliApiKey")}
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
          )}
        </div>

        {isClaude && !isOfficialAnthropicEndpoint(value.baseUrl) && (
          <div className="flex items-center gap-1.5 rounded-lg border border-border-button-default bg-background-secondary-default px-3 py-2 text-body-2-regular text-text-secondary">
            <Cloud className="size-3.5 shrink-0" aria-hidden />
            <span>{t("settings.cliProxyWarning")}</span>
          </div>
        )}

        {isClaude && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-body-medium text-text-primary">
                {t("settings.cliModelMapping")}
              </p>
              <FetchModelsControl
                fetching={fetching}
                error={fetchError}
                count={fetchedModels.length}
                disabled={!value.baseUrl.trim()}
                onFetch={() => void handleFetchModels()}
              />
            </div>
            <datalist id={FETCH_DATALIST_ID}>
              {fetchedModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CLAUDE_MODEL_SLOTS.map(({ slot, envKey }) => (
                <Input
                  key={slot}
                  label={t(slotLabelKey(slot))}
                  size="small"
                  list={FETCH_DATALIST_ID}
                  placeholder={t(`${slotLabelKey(slot)}Placeholder`)}
                  value={slots[slot]}
                  onChange={(model) => {
                    setSlots((s) => ({ ...s, [slot]: model }));
                    updateClaudeEnv(envKey, model);
                  }}
                />
              ))}
            </div>
            <p className="text-body-2-regular text-text-tertiary">
              {t("settings.cliModelMappingHint")}
            </p>
          </div>
        )}

        {isClaude && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-expanded={jsonOpen}
                onClick={() => setJsonOpen((o) => !o)}
                className="flex items-center gap-1 text-body-medium text-text-primary"
              >
                <ChevronDown
                  className={cx("size-3.5 transition-transform", !jsonOpen && "-rotate-90")}
                  aria-hidden
                />
                {t("settings.cliJsonConfig")}
              </button>
              <button
                type="button"
                onClick={handleFormatJson}
                className="rounded-lg border border-border-button-default px-2 py-0.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-secondary-hover"
              >
                {t("settings.cliFormatJson")}
              </button>
            </div>
            {jsonOpen && (
              <>
                <p className="text-body-2-regular text-text-tertiary">
                  {t("settings.cliJsonConfigDesc")}
                </p>
                <TextArea
                  mono
                  rows={14}
                  spellCheck={false}
                  aria-label={t("settings.cliJsonConfig")}
                  value={value.settingsJson}
                  onChange={onJsonChange}
                  isInvalid={!jsonValid}
                  hint={jsonError || undefined}
                  inputClassName="whitespace-pre"
                />
              </>
            )}
          </div>
        )}

        {!isClaude && !isCodex && (
          <div className="flex flex-col gap-2">
            <FetchModelsControl
              fetching={fetching}
              error={fetchError}
              count={fetchedModels.length}
              disabled={!value.baseUrl.trim()}
              onFetch={() => void handleFetchModels()}
            />
            <datalist id={FETCH_DATALIST_ID}>
              {fetchedModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <Input
              label={t("settings.cliModel")}
              size="small"
              list={FETCH_DATALIST_ID}
              value={value.model}
              onChange={(model) => patch({ model })}
            />
          </div>
        )}

        {isCodex && (
          <>
            <TextArea
              mono
              rows={10}
              spellCheck={false}
              label={t("settings.cliConfigToml")}
              hint={t("settings.cliConfigTomlHint")}
              value={value.configToml}
              onChange={(configToml) => patch({ configToml })}
              inputClassName="whitespace-pre"
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-body-medium text-text-primary">
                  {t("settings.cliAuthJson")}
                </p>
                <button
                  type="button"
                  onClick={handleFormatAuthJson}
                  className="rounded-lg border border-border-button-default px-2 py-0.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-secondary-hover"
                >
                  {t("settings.cliFormatJson")}
                </button>
              </div>
              <TextArea
                mono
                rows={4}
                spellCheck={false}
                aria-label={t("settings.cliAuthJson")}
                value={value.authJson}
                onChange={(authJson) => {
                  patch({ authJson });
                  setAuthError("");
                }}
                isInvalid={!authValid}
                hint={authError || t("settings.cliAuthJsonHint")}
                inputClassName="whitespace-pre"
              />
            </div>
          </>
        )}

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
