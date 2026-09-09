import { useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeOmpServiceTier, supportsOmpFastMode, type OmpServiceTier } from "@/lib/omp-service-tier";

export function OmpSpeedSection({ model, value, onChange }: {
  model: string;
  value: OmpServiceTier;
  onChange: (tier: OmpServiceTier) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const supported = supportsOmpFastMode(model);
  return <div className="border-t border-border-secondary px-3 py-2">
    <label className="flex items-center justify-between gap-2 text-body-2-medium text-text-primary">
      {t("chat.ompSpeed")}
      <select
        aria-label={t("chat.ompSpeed")}
        value={supported ? value ?? "inherit" : "inherit"}
        disabled={!supported || saving}
        className="min-w-0 rounded-md border border-border-secondary bg-background-primary px-2 py-1 text-text-primary disabled:opacity-50"
        onChange={async event => {
          const tier = normalizeOmpServiceTier(event.target.value);
          setSaving(true);
          setError(false);
          try { await onChange(tier); }
          catch { setError(true); }
          finally { setSaving(false); }
        }}
      >
        <option value="inherit">{t("chat.ompSpeedInherit")}</option>
        <option value="default">{t("chat.ompSpeedStandard")}</option>
        <option value="priority">Fast</option>
      </select>
    </label>
    <p className="mt-1 text-body-2-regular text-text-tertiary">{t(supported ? "chat.ompSpeedHint" : "chat.ompSpeedUnsupported")}</p>
    {error && <p role="alert" className="mt-1 text-body-2-regular text-text-primary">{t("chat.ompSpeedSaveError")}</p>}
  </div>;
}
