import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Key } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { ModalShell } from "@/components/dialogs";
import type { EngineId } from "./providers";

/** Editable channel fields. `raw` stays with the parent and is merged back
 *  on save so fields this form doesn't know (env, customModels, …) survive. */
export interface ProviderFormValue {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ProviderPreset {
  name: string;
  baseUrl: string;
  model: string;
}

/** Third-party relay presets per engine (flat baseUrl/model shape — what the
 *  backend's env_mapping injects). Ported from the previous app's preset
 *  tables, trimmed to the entries that carry a default model. */
const PRESETS: Partial<Record<EngineId, ProviderPreset[]>> = {
  claude: [
    { name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/anthropic", model: "glm-5.2" },
    { name: "Kimi", baseUrl: "https://api.moonshot.cn/anthropic", model: "kimi-k3" },
    { name: "Kimi Coding", baseUrl: "https://api.kimi.com/coding/", model: "kimi-k3" },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", model: "deepseek-v4-pro[1m]" },
    { name: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic", model: "MiniMax-M2.1" },
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api", model: "anthropic/claude-sonnet-4.5" },
  ],
  kimi: [
    { name: "Kimi Coding", baseUrl: "https://api.kimi.com/coding/v1", model: "kimi-for-coding" },
    { name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "" },
  ],
  grok: [{ name: "xAI Official", baseUrl: "https://api.x.ai/v1", model: "grok-build" }],
  codex: [
    { name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-5.2" },
    { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3" },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
    { name: "MiniMax", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3" },
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "" },
  ],
};

interface ProviderDialogProps {
  engine: EngineId;
  title: string;
  initial?: ProviderFormValue;
  onSubmit: (value: ProviderFormValue) => void;
  onCancel: () => void;
}

/** Add/edit one channel. Selecting a preset prefills name/URL/model; the
 *  fields stay editable afterwards (preset = starting point, not a mode). */
export function ProviderDialog({ engine, title, initial, onSubmit, onCancel }: ProviderDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState<ProviderFormValue>(
    initial ?? { name: "", baseUrl: "", apiKey: "", model: "" },
  );
  const presets = PRESETS[engine] ?? [];

  const onPresetChange = (key: Key | null) => {
    const preset = presets.find((p) => p.name === key);
    if (!preset) return;
    setValue((v) => ({ ...v, name: preset.name, baseUrl: preset.baseUrl, model: preset.model }));
  };

  const patch = (p: Partial<ProviderFormValue>) => setValue((v) => ({ ...v, ...p }));
  const valid = value.name.trim() !== "" && value.baseUrl.trim() !== "";

  return (
    <ModalShell onClose={onCancel} className="w-96">
      <p className="text-body-medium text-text-primary">{title}</p>
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(value);
        }}
      >
        {presets.length > 0 && (
          <Select
            aria-label={t("settings.cliPreset")}
            placeholder={t("settings.cliPresetCustom")}
            onSelectionChange={onPresetChange}
          >
            {presets.map((p) => (
              <SelectItem key={p.name} id={p.name}>
                {p.name}
              </SelectItem>
            ))}
          </Select>
        )}
        <Input
          label={t("settings.cliName")}
          size="small"
          value={value.name}
          onChange={(name) => patch({ name })}
          autoFocus
        />
        <Input
          label={t("settings.cliBaseUrl")}
          size="small"
          placeholder="https://…"
          value={value.baseUrl}
          onChange={(baseUrl) => patch({ baseUrl })}
        />
        <Input
          label={t("settings.cliApiKey")}
          size="small"
          value={value.apiKey}
          onChange={(apiKey) => patch({ apiKey })}
        />
        <Input
          label={t("settings.cliModel")}
          size="small"
          value={value.model}
          onChange={(model) => patch({ model })}
        />
        <div className="mt-1 flex justify-end gap-2">
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
