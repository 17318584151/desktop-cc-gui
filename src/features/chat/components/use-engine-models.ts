import { useEffect, useMemo, useState } from "react";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import { ipc, type CliConfig, type EngineCatalog, type EngineInfo } from "@/lib/ipc";
import {
  CLI_CONFIG_CHANGED_EVENT,
  isPseudoProvider,
  providerModel,
  type EngineId,
} from "@/features/settings/providers";

/** Provider configs and per-engine model catalogs feeding the CLI menu's
 * per-engine model flyouts, plus the pin effect that repairs unset or stale
 * stored model picks. */
export function useEngineModels(
  engines: EngineInfo[],
  models: Record<string, string>,
  pinModels: (updates: Record<string, string>) => Promise<void>,
) {
  const [cliConfig, setCliConfig] = useState<CliConfig | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, EngineCatalog>>({});

  // Provider configs feed the model picker's per-engine model lists.
  useEffect(() => {
    ipc.getCliConfig().then(setCliConfig).catch(() => {});
  }, []);
  // The settings CLI page mutates provider config outside this tree; refetch
  // so the model picker tracks channel switches immediately.
  useEffect(() => {
    const reload = () => ipc.getCliConfig().then(setCliConfig).catch(() => {});
    window.addEventListener(CLI_CONFIG_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CLI_CONFIG_CHANGED_EVENT, reload);
  }, []);
  // Model catalogs for every engine (pi/omp probe their CLI; others return
  // empty and fall back to provider-config models below). The CLI menu's
  // per-engine model flyouts all read from this map.
  useEffect(() => {
    let cancelled = false;
    for (const engine of engines) {
      if (engine.id in catalogs) continue;
      ipc
        .listEngineModels(engine.id)
        .then((list) => {
          if (!cancelled) setCatalogs((prev) => ({ ...prev, [engine.id]: list }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [engines, catalogs]);

  // Per-engine model lists for the CLI menu flyouts: the backend catalog
  // plus, for channel-driven engines, the current provider channel's
  // configured model (both describe the channel the engine would actually
  // launch with), with the current override appended so the selection never
  // vanishes. Claude is exempt: it runs on the CLI's own configuration
  // (~/.claude/settings.json), so app channels contribute nothing.
  const modelsByEngine = useMemo(() => {
    const result: Record<string, ModelOption[]> = {};
    for (const engine of engines) {
      const section = cliConfig?.[engine.id as EngineId];
      const currentId = section?.current ?? "";
      const currentRaw =
        engine.id !== "claude" && currentId && !isPseudoProvider(currentId)
          ? section?.providers?.[currentId]
          : undefined;
      const configured = currentRaw
        ? providerModel(engine.id as EngineId, currentRaw).trim()
        : "";
      const providerModels = configured ? [configured] : [];
      const current = models[engine.id]?.trim();
      const catalog = catalogs[engine.id]?.models ?? [];
      // A channel's configured model leads (it is what the CLI would run
      // unprompted); backend catalogs put the CLI default first.
      const known = [
        ...new Set([...providerModels, ...catalog.map((m) => m.id), ...(current ? [current] : [])]),
      ];
      const nameById = new Map(catalog.map((m) => [m.id, m.name]));
      result[engine.id] = known.map((m) => ({ id: m, label: nameById.get(m) || m }));
    }
    return result;
  }, [engines, cliConfig, catalogs, models]);
  // Selectable ids WITHOUT the current-override append: what the channel
  // plus the backend catalog can actually serve.
  const knownIdsByEngine = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const engine of engines) {
      const section = cliConfig?.[engine.id as EngineId];
      const currentId = section?.current ?? "";
      const currentRaw =
        engine.id !== "claude" && currentId && !isPseudoProvider(currentId)
          ? section?.providers?.[currentId]
          : undefined;
      const configured = currentRaw
        ? providerModel(engine.id as EngineId, currentRaw).trim()
        : "";
      const ids = new Set((catalogs[engine.id]?.models ?? []).map((m) => m.id));
      if (configured) ids.add(configured);
      result[engine.id] = ids;
    }
    return result;
  }, [engines, cliConfig, catalogs]);
  // No "default" pseudo entry: an unset selection would hide which model
  // actually runs. Pin it to the first entry — the CLI's effective default.
  // An authoritative catalog also invalidates stale stored picks (leftovers
  // from older, broader catalogs) that the CLI's model flag cannot resolve.
  // All engines' pins are computed first and written in ONE store action:
  // per-engine setModel would mean one settings persist round-trip each.
  useEffect(() => {
    const updates: Record<string, string> = {};
    for (const engine of engines) {
      const first = modelsByEngine[engine.id]?.[0];
      if (!first) continue;
      const stored = models[engine.id]?.trim();
      if (!stored) {
        updates[engine.id] = first.id;
        continue;
      }
      const catalog = catalogs[engine.id];
      if (
        catalog?.authoritative &&
        catalog.models.length > 0 &&
        !knownIdsByEngine[engine.id]?.has(stored)
      ) {
        updates[engine.id] = first.id;
      }
    }
    if (Object.keys(updates).length > 0) void pinModels(updates);
  }, [engines, models, modelsByEngine, catalogs, knownIdsByEngine, pinModels]);

  return { catalogs, modelsByEngine };
}
