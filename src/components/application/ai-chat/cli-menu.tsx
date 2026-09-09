import { OmpSpeedSection } from "./omp-speed-section";
import { supportsOmpFastMode, type OmpServiceTier } from "@/lib/omp-service-tier";
"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import X from "lucide-react/dist/esm/icons/x";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
  Slider as AriaSlider,
  SliderThumb as AriaSliderThumb,
  SliderTrack as AriaSliderTrack,
} from "react-aria-components";
import { AnimatePresence, m } from "motion/react";
import { menuPopoverSurface } from "@/components/base/dropdown/menu-styles";
import { ModalShell } from "@/components/dialogs";
import { CLI_DISPLAY_NAMES, inferModelEngine } from "@/components/foundations/icons/engine-brands";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { MOBILE_MEDIA, useMediaQuery } from "@/hooks/use-media-query";
import { cx } from "@/utils/cx";
import { usePopoverState } from "@/utils/use-dismiss-on-outside-press";
import { FlameOverlay } from "./effort-flame";
import { EFFORT_LEVELS } from "./effort-levels";

/**
 * Board UI → "ai_chat" dropdowns (nodes 4035:6313 / 4035:6925), adapted to
 * live data. Same react-aria non-modal popover recipe as the template;
 * contents are props-driven:
 * - CliMenu — CLI + model switcher opened from the composer's engine
 *   button: each engine row flies out a model + effort panel to the right
 *   (search field over a "Models" radio group over the effort slider,
 *   Board UI node 4035:6925). */

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** CLI picker panel: shadcn-style menu (reference: desktop-cc-gui's
 *  ModelSelect) — 8px radius, 4px padding, hairline separators between rows,
 *  no header label. Distinct from the other ai_chat popovers above. */
const CLI_POPOVER_CLASSES = menuPopoverSurface({
  width: "w-64",
  origin: "origin-bottom-left",
  radius: "rounded-lg",
  padding: "p-1",
});

/* ------------------------------------------------------------- engine picker */

export interface MenuOption {
  id: string;
  label: string;
  /** Engine is installed and spawnable — drives the status dot. */
  available?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

const EFFORT_LABEL_KEYS: Record<EffortLevel, string> = {
  low: "chat.effortLow",
  medium: "chat.effortMedium",
  high: "chat.effortHigh",
  xhigh: "chat.effortXhigh",
  max: "chat.effortMax",
};

/** Fresh random impulse per tick each time the engine ignites: blown left by
 *  the exhaust with random lift, tumble and stagger, like debris. */
function useBlastImpulses(isMax: boolean) {
  return useMemo(
    () =>
      EFFORT_LEVELS.map(() => ({
        x: -(70 + Math.random() * 130),
        y: (Math.random() - 0.5) * 70,
        rotate: (Math.random() - 0.5) * 720,
        delay: Math.random() * 0.3,
      })),
    [isMax],
  );
}

/** The tick row on the effort track: one tick per stop, fading past the
 *  current value; at max they blast off like exhaust debris. */
function EffortTicks({
  index,
  isMax,
  blast,
}: {
  index: number;
  isMax: boolean;
  blast: { x: number; y: number; rotate: number; delay: number }[];
}) {
  return (
    <div className="absolute inset-x-[9px] top-[7px] flex h-[13px] items-center justify-between">
      {EFFORT_LEVELS.map((level, i) => (
        <m.span
          key={level}
          aria-hidden
          animate={
            isMax
              ? {
                  x: blast[i].x,
                  y: blast[i].y,
                  rotate: blast[i].rotate,
                  opacity: 0,
                }
              : { x: 0, y: 0, rotate: 0, opacity: i > index ? 0.3 : 1 }
          }
          transition={
            isMax
              ? { duration: 1.6, ease: [0.22, 0.5, 0.5, 1], delay: blast[i].delay }
              : { duration: 0.3, ease: "easeOut" }
          }
          className="h-full w-[3px] rounded-[2px] bg-foreground-icon-tertiary"
        />
      ))}
    </div>
  );
}

/**
 * Effort slider (Board UI Figma node 4037:4885, five stops here): 27px
 * neutral track with a tick per stop, a light fill up to the 21×27 bordered
 * thumb. Built on react-aria's Slider for drag + keyboard support.
 *
 * The thumb travels edge to edge: its center moves from 10.5px to
 * (width − 10.5)px, and the tick row is inset to match, so ticks sit on the
 * stops at any rendered width. At max the ticks blast off like exhaust
 * debris and the flame shader washes over the track.
 */
function EffortSlider({
  value,
  onChange,
}: {
  value: EffortLevel;
  onChange: (level: EffortLevel) => void;
}) {
  const { t } = useTranslation();
  const index = Math.max(0, EFFORT_LEVELS.indexOf(value));
  const isMax = index === EFFORT_LEVELS.length - 1;
  const blast = useBlastImpulses(isMax);
  // Thumb center sits at `fraction` of the 21px-inset rail, so its right
  // edge is at fraction × (track − 21px) + 21px — in calc() so the fill
  // lands flush against the thumb at any rendered width.
  const fraction = index / (EFFORT_LEVELS.length - 1);

  return (
    <AriaSlider
      aria-label={t("chat.effort")}
      minValue={0}
      maxValue={EFFORT_LEVELS.length - 1}
      step={1}
      value={index}
      onChange={(v) => onChange(EFFORT_LEVELS[v as number] ?? "medium")}
      className="w-full"
    >
      <div className="relative h-[27px] w-full overflow-hidden rounded-lg bg-background-secondary-default">
        {/* Fill up to the thumb's right edge. */}
        <div
          className="absolute inset-y-0 left-0 rounded-lg bg-background-tertiary-hover transition-[width] duration-150 ease-out"
          style={{ width: `calc(${fraction} * (100% - 21px) + 21px)` }}
        />
        <EffortTicks index={index} isMax={isMax} blast={blast} />
        {/* Above the ticks so the flame washes over the step dividers. */}
        <AnimatePresence>{isMax && <FlameOverlay />}</AnimatePresence>
        {/* Rail inset by half the thumb width so the 21px thumb lands flush
            on both track edges. The wrapper does the absolute positioning
            because SliderTrack forces `position: relative` inline. */}
        <div className="absolute inset-x-[10.5px] inset-y-0">
          <AriaSliderTrack className="h-full w-full">
            <AriaSliderThumb className="top-1/2 h-[27px] w-[21px] cursor-grab rounded-[7px] border border-border-checkbox-default bg-background-primary-default shadow-xs outline-none transition-shadow data-[dragging]:cursor-grabbing data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring" />
          </AriaSliderTrack>
        </div>
      </div>
    </AriaSlider>
  );
}

export interface ModelOption {
  /** "" selects the CLI/provider default model. */
  id: string;
  label: string;
  /** Secondary line under the label (e.g. "Custom Opus model"). */
  description?: string;
  /** Catalog provider ("kimi-code"); derived from the "provider/model" id
   *  when the catalog entry is missing. Two or more distinct providers turn
   *  the flyout list into labeled sections. */
  provider?: string;
}

/** Per-engine model flyout: pops to the right of the CLI popover, bottom-
 *  aligned with the engine list so the taller panel never clips below the
 *  composer-anchored popover. */
const FLYOUT_CLASSES = cx(
  "absolute left-full bottom-0 z-10 ml-2 w-80 max-w-[calc(100vw-32px)]",
  "rounded-lg border border-border-button-default bg-background-primary-default p-1 shadow-dropdown",
);

/* -------------------------------------------------------------- engine row */

/** One engine row in the CLI list: brand mark, name, selection dot (active
 *  engine only) and the chevron that hints at the flyout. */
function EngineRow({
  option,
  selected,
  flyoutOpen,
  onSelect,
  onHover,
}: {
  option: MenuOption;
  selected: boolean;
  /** This engine's flyout is currently open. */
  flyoutOpen: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      aria-disabled={option.disabled || undefined}
      title={option.disabled ? option.disabledReason : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors",
        selected || flyoutOpen
          ? "bg-background-primary-hover"
          : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
        option.disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <EngineIcon
        engine={option.id}
        size={18}
        className="shrink-0 text-foreground-icon-primary"
      />
      <span className="text-body-medium text-text-primary">
        {CLI_DISPLAY_NAMES[option.id] ?? option.label}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {selected && (
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-notification-success-foreground"
          />
        )}
        <ChevronRight
          className="size-4 text-foreground-icon-secondary"
          aria-hidden
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ flyout */

/** One checkmark model row inside the flyout's radio group. */
function ModelRow({
  option,
  selected,
  engineId,
  onPick,
}: {
  option: ModelOption;
  selected: boolean;
  engineId: string;
  onPick: (engine: string, id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(engineId, option.id)}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
        selected
          ? "bg-background-primary-hover"
          : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
      )}
    >
      <EngineIcon
        engine={inferModelEngine(option.label) ?? inferModelEngine(option.id) ?? engineId}
        size={18}
        className="shrink-0 text-foreground-icon-primary"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body-medium whitespace-nowrap text-text-primary">
          {option.label}
        </span>
        {/* CLI /model-menu style subtitle ("Custom Opus model"); absent
            for plain catalog rows. */}
        {option.description && (
          <span className="truncate text-body-2-regular whitespace-nowrap text-text-secondary">
            {option.description}
          </span>
        )}
      </span>
      {selected && (
        <Check
          className="ml-auto size-4 shrink-0 text-foreground-icon-primary"
          aria-hidden
        />
      )}
    </button>
  );
}

/** The flyout's effort section: label with a keyed blur-in value, the
 *  faster/smarter captions, and the five-stop slider. */
interface ModelGroup {
  /** Provider id, "" for rows with no provider. */
  key: string;
  rows: ModelOption[];
}

/** Bucket rows by provider, first-appearance order. Returns a single
 *  keyless group when fewer than two providers are present — layering only
 *  earns its headers when it actually separates sources. */
function groupModelsByProvider(models: ModelOption[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  const byKey = new Map<string, ModelGroup>();
  for (const model of models) {
    const key = model.provider ?? "";
    let group = byKey.get(key);
    if (!group) {
      group = { key, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(model);
  }
  const labeled = groups.filter((g) => g.key !== "");
  return labeled.length > 1 ? groups : [{ key: "", rows: models }];
}

function FlyoutEffortSection({
  effort,
  onChange,
  header,
}: {
  effort: EffortLevel;
  onChange: (level: EffortLevel) => void;
  header?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col">
      {header ?? <span className="pl-2 text-body-medium text-text-secondary">
        {t("chat.effort")}{" "}
        {/* Keyed on the value so each change remounts and blurs in. */}
        <m.span
          key={effort}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="inline-block text-text-primary"
        >
          {t(EFFORT_LABEL_KEYS[effort])}
        </m.span>
      </span>}
      <div className="flex w-full items-center justify-between px-2 pt-2 pb-[3px]">
        <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
          {t("chat.effortFaster")}
        </span>
        <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
          {t("chat.effortSmarter")}
        </span>
      </div>
      <div className="w-full px-2 pb-2">
        <EffortSlider value={effort} onChange={onChange} />
      </div>
    </div>
  );
}

/**
 * Engine model panel content: "{name} 引擎" header over a search field over
 * checkmark model rows over the effort slider. Shared by the desktop flyout
 * (EngineFlyout) and the mobile second-level dialog; `onClose` adds a
 * dismiss button to the header, which only the dialog passes. Picking a
 * model dismisses the whole menu (handled by the parent via `onPickModel`).
 */
function EngineModelPanel({
  option,
  models,
  selectedModelId,
  query,
  onQueryChange,
  effort,
  onPickModel,
  onEffortChange,
  ompServiceTier,
  onOmpServiceTierChange,
  onRefresh,
  onClose,
}: {
  option: MenuOption;
  models: ModelOption[];
  selectedModelId: string;
  query: string;
  onQueryChange: (value: string) => void;
  effort: EffortLevel;
  onPickModel: (engine: string, id: string) => void;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  /** Re-probe provider configs and model catalogs without an app restart. */
  onRefresh?: () => void | Promise<void>;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = normalizedQuery
    ? models.filter(
        (m) =>
          m.label.toLowerCase().includes(normalizedQuery) ||
          m.id.toLowerCase().includes(normalizedQuery) ||
          (m.description ?? "").toLowerCase().includes(normalizedQuery),
      )
    : models;
  // Provider sections layer the list when the engine's catalog mixes sources
  // (OMP serving several relays). Pinning the active row to the top would
  // tear it out of its section, so grouped lists keep the catalog order and
  // mark the pick in place; flat and searched lists keep the pin.
  const groups = useMemo(() => groupModelsByProvider(filteredModels), [filteredModels]);
  const layered = !normalizedQuery && groups.length > 1;
  const orderedModels =
    normalizedQuery || layered
      ? filteredModels
      : [...filteredModels].sort(
          (a, b) =>
            Number(b.id === selectedModelId) - Number(a.id === selectedModelId),
        );
  // The section holding the current pick leads so the selection is never
  // scrolled out of view; within sections the catalog order stands.
  const visibleGroups = layered
    ? [...groups].sort(
        (a, b) =>
          Number(b.rows.some((m) => m.id === selectedModelId)) -
          Number(a.rows.some((m) => m.id === selectedModelId)),
      )
    : null;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate px-2 py-1.5 text-body-medium text-text-secondary">
          {t("chat.engineHeader", {
            name: CLI_DISPLAY_NAMES[option.id] ?? option.label,
          })}
        </span>
        {(onRefresh || onClose) && (
          <span className="mr-1 flex shrink-0 items-center">
            {onRefresh && (
              <button
                type="button"
                aria-label={t("common.refresh")}
                title={t("common.refresh")}
                disabled={refreshing}
                onClick={() => {
                  if (refreshing) return;
                  setRefreshing(true);
                  Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
                }}
                className="flex size-7 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:cursor-default"
              >
                <RefreshCw
                  className={cx("size-3.5", refreshing && "animate-spin")}
                  aria-hidden
                />
              </button>
            )}
            {onClose && (
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={onClose}
                className="flex size-7 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </span>
        )}
      </div>
      <div className="relative mx-1 -mt-1.5 pb-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-[calc(50%+2px)] text-foreground-icon-secondary"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("chat.modelSearchPlaceholder")}
          aria-label={t("chat.modelSearchPlaceholder")}
          className="h-8 w-full rounded-md border border-separator-border bg-background-secondary-default pr-2 pl-7 text-body-regular text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        />
      </div>
      <div
        className="flex max-h-[240px] w-full flex-col overflow-y-auto"
        role="radiogroup"
        aria-label={t("chat.modelPicker")}
      >
        {(visibleGroups ?? [{ key: "", rows: orderedModels }]).map((group) => (
          <div key={group.key || "__flat__"} className="flex w-full flex-col">
            {group.key && (
              <span className="sticky top-0 z-10 bg-background-primary-default px-2 pt-1.5 pb-0.5 text-body-2-medium text-text-tertiary">
                {group.key}
              </span>
            )}
            {group.rows.map((model) => (
              <ModelRow
                key={model.id || "__default__"}
                option={model}
                selected={model.id === selectedModelId}
                engineId={option.id}
                onPick={onPickModel}
              />
            ))}
          </div>
        ))}
        {orderedModels.length === 0 && (
          <span className="p-2 text-body-medium text-text-tertiary">
            {t("chat.noMatchingModels")}
          </span>
        )}
      </div>

      {/* Full-bleed divider, like the reference submenu. */}
      <div aria-hidden className="-mx-1 mt-[7px] mb-3 h-px bg-border-button-default" />
      <FlyoutEffortSection
        header={option.id === "omp" ? (
          <OmpSpeedSection model={selectedModelId} value={ompServiceTier} onChange={onOmpServiceTierChange}>
            <span className="text-body-medium text-text-primary">{t(EFFORT_LABEL_KEYS[effort])}</span>
            <span className="max-w-full truncate text-body-2-regular text-text-tertiary" title={models.find(model => model.id === selectedModelId)?.label ?? selectedModelId}>
              {models.find(model => model.id === selectedModelId)?.label || selectedModelId || t("chat.ompSpeedInherit")}
            </span>
          </OmpSpeedSection>
        ) : undefined}
        effort={effort}
        onChange={(level) => onEffortChange(option.id, level)}
      />
    </div>
  );
}

/** Desktop-only wrapper: the model panel as a flyout popping to the right of
 *  the CLI popover. On mobile CliMenu renders the same panel in a modal
 *  dialog instead (hover flyouts don't work on touch). */
function EngineFlyout(props: Parameters<typeof EngineModelPanel>[0]) {
  return (
    <div className={FLYOUT_CLASSES}>
      <EngineModelPanel {...props} />
    </div>
  );
}

/**
 * CLI + model switcher, visually mirroring the reference ModelSelect
 * (desktop-cc-gui): a borderless trigger showing the full selection —
 * "{CLI} / {model} · {effort}" — hairline-separated engine rows where
 * only the active engine carries a status dot, and a per-engine flyout.
 * Picking a model in another engine's flyout switches to that engine (when
 * installed), matching the reference picker's behavior.
 */
export function CliMenu({
  options,
  value,
  onChange,
  modelsByEngine,
  models,
  onModelChange,
  efforts,
  onEffortChange,
  ompServiceTier,
  onOmpServiceTierChange,
  onRefreshModels,
}: {
  options: MenuOption[];
  value: string;
  onChange: (id: string) => void;
  /** Per-engine model lists; concrete ids only, CLI default first. */
  modelsByEngine: Record<string, ModelOption[]>;
  /** Selected model id per engine. */
  models: Record<string, string>;
  onModelChange: (engine: string, id: string) => void;
  /** Per-engine reasoning effort, rendered under each flyout's model list. */
  efforts: Record<string, EffortLevel>;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  /** Re-probe provider configs and model catalogs (flyout refresh button). */
  onRefreshModels?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { isOpen, triggerRef, popoverRef, close, setOpen } = usePopoverState();
  const current = options.find((o) => o.id === value);

  // Trigger carries the whole selection at a glance:
  // "Claude Code / 默认 · 高" (CLI name / model / effort). The model part
  // only drops out when the engine has no model list at all.
  const selectedModelId = models[value] ?? "";
  const selectedModel = (modelsByEngine[value] ?? []).find((m) => m.id === selectedModelId);
  const engineName = CLI_DISPLAY_NAMES[value] ?? current?.label ?? value;
  const triggerEffort: EffortLevel = efforts[value] ?? "medium";

  // Which engine's model flyout is open. Pre-opens on the active engine so
  // the current selection is visible the moment the menu opens.
  const [openEngine, setOpenEngine] = useState<string | null>(null);
  // Mobile has no hover, so the flyout never renders there; tapping an
  // engine row opens the same panel as a second-level modal instead.
  const isMobile = useMediaQuery(MOBILE_MEDIA);
  const [dialogEngine, setDialogEngine] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const closeTimer = useRef<number | null>(null);
  const cancelFlyoutClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Brief grace period so the pointer can cross the gap into the flyout.
  const scheduleFlyoutClose = () => {
    cancelFlyoutClose();
    closeTimer.current = window.setTimeout(() => setOpenEngine(null), 150);
  };
  useEffect(() => {
    setQuery("");
  }, [openEngine, dialogEngine]);
  useEffect(() => () => cancelFlyoutClose(), []);

  const handleOpenChange = (o: boolean) => {
    if (!setOpen(o)) return;
    setOpenEngine(o ? value : null);
    if (!o) setQuery("");
  };

  const flyoutOption = options.find((o) => o.id === openEngine);
  const dialogOption = options.find((o) => o.id === dialogEngine);

  // Picking a model is the decision the flyout exists for, so it dismisses
  // the whole menu; a model picked on another installed engine also switches
  // the active engine to it.
  const pickModel = (engine: string, id: string) => {
    onModelChange(engine, id);
    const target = options.find((o) => o.id === engine);
    if (engine !== value && target && !target.disabled) onChange(engine);
    close();
    setOpenEngine(null);
    setDialogEngine(null);
  };

  return (
    <>
    <AriaDialogTrigger isOpen={isOpen} onOpenChange={handleOpenChange}>
      <AriaButton
        ref={triggerRef}
        // min-w-0 lets the trigger shrink instead of pushing the send button
        // out of the composer on narrow widths; below md the trigger collapses
        // to icon + truncated model (aria-label carries the full selection).
        aria-label={`${engineName}${selectedModel ? ` / ${selectedModel.label}` : ""} · ${t(EFFORT_LABEL_KEYS[triggerEffort])}`}
        className="group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <EngineIcon engine={value} size={16} className="shrink-0 text-foreground-icon-secondary" />
        <span className="flex min-w-0 items-center gap-1 text-body-2-medium whitespace-nowrap text-text-secondary transition-colors duration-150 ease group-hover:text-text-primary">
          <span className="shrink-0 max-md:hidden">{engineName}</span>
          {selectedModel && (
            <>
              <span aria-hidden className="shrink-0 text-text-tertiary max-md:hidden">
                /
              </span>
              <span className="max-w-44 truncate max-md:max-w-28">{selectedModel.label}</span>
            </>
          )}
          <span aria-hidden className="shrink-0 text-text-tertiary max-md:hidden">
            ·
          </span>
          <span className="shrink-0 max-md:hidden">{t(EFFORT_LABEL_KEYS[triggerEffort])}</span>
          {value === "omp" && supportsOmpFastMode(models[value] ?? "") && (
            // Preserve the trigger's width: this popover is anchored to its
            // right edge, so inserting/removing the badge moves both panels.
            <span aria-hidden={ompServiceTier !== "priority"} className={cx("w-7 shrink-0 text-center text-text-primary", ompServiceTier !== "priority" && "invisible")}>Fast</span>
          )}
        </span>
      </AriaButton>

      <AriaPopover
        ref={popoverRef}
        isNonModal
        placement="top end"
        offset={8}
        className={CLI_POPOVER_CLASSES}
      >
        <AriaDialog aria-label={t("chat.cliPicker")} className="outline-none">
          <div className="flex w-full flex-col">
            <div
              className="relative"
              onMouseEnter={cancelFlyoutClose}
              onMouseLeave={scheduleFlyoutClose}
            >
              <div className="flex w-full flex-col">
                {options.map((option, index) => (
                  <Fragment key={option.id}>
                    {index > 0 && (
                      <div
                        aria-hidden
                        className="-mx-1 my-1 border-t border-separator-border"
                      />
                    )}
                    {/* Not `disabled`: that attribute would swallow hover
                        events and leave a stale flyout on the prior engine. */}
                    <EngineRow
                      option={option}
                      selected={option.id === value}
                      flyoutOpen={option.id === openEngine}
                      onSelect={() => {
                        // Mobile: the row tap drills into the second-level
                        // model dialog instead of switching engines outright
                        // — the engine switches when a model is picked there.
                        if (isMobile) {
                          setDialogEngine(option.id);
                          close();
                          return;
                        }
                        if (option.disabled) return;
                        onChange(option.id);
                        close();
                      }}
                      onHover={() => {
                        if (isMobile) return;
                        cancelFlyoutClose();
                        setOpenEngine(option.id);
                      }}
                    />
                  </Fragment>
                ))}
              </div>

              {!isMobile && flyoutOption && (
                <EngineFlyout
                  option={flyoutOption}
                  models={modelsByEngine[flyoutOption.id] ?? []}
                  selectedModelId={models[flyoutOption.id] ?? ""}
                  query={query}
                  onQueryChange={setQuery}
                  effort={efforts[flyoutOption.id] ?? "medium"}
                  onPickModel={pickModel}
                  onEffortChange={onEffortChange}
                  ompServiceTier={ompServiceTier}
                  onOmpServiceTierChange={onOmpServiceTierChange}
                  onRefresh={onRefreshModels}
                />
              )}
            </div>
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>

    {dialogOption && (
      <ModalShell
        onClose={() => setDialogEngine(null)}
        className="max-w-[calc(100vw-32px)]"
      >
        <EngineModelPanel
          option={dialogOption}
          models={modelsByEngine[dialogOption.id] ?? []}
          selectedModelId={models[dialogOption.id] ?? ""}
          query={query}
          onQueryChange={setQuery}
          effort={efforts[dialogOption.id] ?? "medium"}
          onPickModel={pickModel}
          onEffortChange={onEffortChange}
          ompServiceTier={ompServiceTier}
          onOmpServiceTierChange={onOmpServiceTierChange}
          onRefresh={onRefreshModels}
          onClose={() => setDialogEngine(null)}
        />
      </ModalShell>
    )}
    </>
  );
}
