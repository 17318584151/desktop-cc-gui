import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Puzzle from "lucide-react/dist/esm/icons/puzzle";
import {
  SettingsModal,
  type SettingsNavGroup,
} from "@/components/application/settings/settings-modal";
import { pluginIdFromRegistryKey, settingsRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { ENGINE_IDS, type EngineId } from "./providers";
import { CliHeaderActions } from "./CliHeaderActions";
import { readStoredJson, writeStored } from "@/lib/storage";
// Side-effect import: registers all builtin sections into settingsRegistry.
import "./sections";

/** Rail meta for known nav groups (label + rail order). A group the SDK adds
 *  later isn't listed here — it falls back to label = group id, appended
 *  after the known rails, so new groups render instead of silently
 *  vanishing (empty groups are filtered out as before). */
const GROUP_META: Record<string, { labelKey: string; order: number }> = {
  settings: { labelKey: "settings.title", order: 0 },
  cli: { labelKey: "settings.cliManage", order: 1 },
};
const KNOWN_GROUP_COUNT = Object.keys(GROUP_META).length;
/** localStorage key for the user's CLI 管理 rail order (section keys). */
const CLI_NAV_ORDER_KEY = "ccgui-next.settingsCliNavOrder:v1";

const readCliNavOrder = (): string[] =>
  readStoredJson(CLI_NAV_ORDER_KEY, (value) =>
    Array.isArray(value) && value.every((k) => typeof k === "string")
      ? (value as string[])
      : null,
  ) ?? [];

/** Items in the user's stored order; keys absent from the stored list (new
 *  engines) keep their registry order at the end — Array.sort is stable. */
const orderByStoredKeys = <T extends { key: string }>(items: T[], keys: string[]): T[] => {
  const rank = new Map(keys.map((key, index) => [key, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.key) ?? keys.length) - (rank.get(b.key) ?? keys.length),
  );
};

/** Unknown page params fall back to General. */
const renderPage = (key: string) => {
  const def = settingsRegistry.get(key);
  if (!def) {
    const fallback = settingsRegistry.get("general");
    return fallback ? <fallback.component /> : null;
  }
  const Component = def.component;
  // Plugin-rendered pages are wrapped so a render crash unmounts only the
  // plugin subtree (plan acceptance 1b); host pages stay unwrapped.
  if (key.startsWith("plugin:")) {
    return (
      <PluginBoundary pluginId={pluginIdFromRegistryKey(key)}>
        <Component />
      </PluginBoundary>
    );
  }
  return <Component />;
};
/** CLI 管理 pages get the docs/version/update cluster next to the title. */
const renderHeaderActions = (key: string) => {
  if (!key.startsWith("cli:")) return null;
  const engine = key.slice("cli:".length);
  if (!(ENGINE_IDS as readonly string[]).includes(engine)) return null;
  return <CliHeaderActions engine={engine as EngineId} />;
};

/**
 * Settings route: overlay for the BoardUI settings modal. ChatPage itself is mounted once
 * by App on every route, so opening and closing settings never rebuilds
 * the chat tree.
 *
 * Nav groups and pages come from settingsRegistry: builtin sections register
 * in ./sections, plugin sections arrive via ctx.ui.registerSettingsSection
 * (plan §4.2 #1).
 */
export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sections = useRegistry(settingsRegistry);
  const [cliNavOrder, setCliNavOrder] = useState<string[]>(readCliNavOrder);
  /** CLI 管理 rail keys in display order (user order wins over registry order). */
  const orderedCliKeys = useMemo(() => {
    const keys = sections
      .filter((def) => def.group === "cli")
      .sort((a, b) => a.order - b.order)
      .map((def) => def.key);
    return orderByStoredKeys(
      keys.map((key) => ({ key })),
      cliNavOrder,
    ).map((entry) => entry.key);
  }, [sections, cliNavOrder]);
  // Legacy links land on a CLI 管理 page: ?page=cliConfig → first CLI,
  // ?page=dsh → the DSH engine page (its host section merged there).
  const rawPage = searchParams.get("page") ?? "general";
  const pageParam =
    rawPage === "cliConfig" ? (orderedCliKeys[0] ?? "general") : rawPage === "dsh" ? "cli:dsh" : rawPage;

  const groups = useMemo<SettingsNavGroup[]>(() => {
    const sorted = [...sections].sort((a, b) => a.order - b.order);
    // Bucket by group in first-seen order; unknown groups (new SDK group
    // values) keep their own rail instead of joining nothing.
    const byGroup = new Map<string, SettingsNavGroup["items"]>();
    for (const def of sorted) {
      const item = { key: def.key, label: def.label(), icon: def.icon ?? Puzzle };
      const bucket = byGroup.get(def.group);
      if (bucket) bucket.push(item);
      else byGroup.set(def.group, [item]);
    }
    // Re-render the rail on language flips: labels are functions of i18n.
    return [...byGroup.entries()]
      .map(([group, items], index) => {
        const meta = GROUP_META[group];
        return {
          label: meta ? t(meta.labelKey) : group,
          order: meta?.order ?? KNOWN_GROUP_COUNT + index,
          items: group === "cli" ? orderByStoredKeys(items, orderedCliKeys) : items,
          // The CLI 管理 rail is drag-sortable; the order persists across
          // sessions (localStorage) and new engines append at the end.
          ...(group === "cli"
            ? {
                onReorderItems: (orderedKeys: string[]) => {
                  setCliNavOrder(orderedKeys);
                  writeStored(CLI_NAV_ORDER_KEY, JSON.stringify(orderedKeys));
                },
                dragHandleLabel: t("settings.cliDrag"),
              }
            : {}),
        };
      })
      .sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, t, i18n.language, cliNavOrder, orderedCliKeys]);

  const titles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const def of sections) map[def.key] = def.label();
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, i18n.language]);

  return (
    <SettingsModal
      isOpen
      onClose={() => navigate("/")}
      defaultPage={pageParam}
      ariaLabel={t("settings.title")}
      groups={groups}
      titles={titles}
      renderPage={renderPage}
      renderHeaderActions={renderHeaderActions}
    />
  );
}
