"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cx } from "@/utils/cx";

/**
 * AgentProgress — BoardUI agent-progress, controlled variant.
 *
 * The registry original runs a self-contained demo clock (fixed per-step
 * durations, auto-advance). Real task/subagent progress has no known
 * durations and can run steps in parallel, so this variant is driven
 * entirely by the `states` prop: the caller owns step order and status,
 * this component owns all motion — staggered reveal, active-step pill,
 * indeterminate progress rings, minimize/expand.
 */

const STEP_REVEAL_STAGGER_SECONDS = 0.05;
const STEP_REVEAL_DURATION_SECONDS = 0.32;
const MODULE_EXPAND_SECONDS = 0.5;
const MODULE_REOPEN_SECONDS = 0.24;

const SPRING = {
  type: "spring" as const,
  stiffness: 260,
  damping: 30,
  mass: 0.8,
};

const EASE = [0.22, 1, 0.36, 1] as const;

export type AgentStepState = "pending" | "active" | "complete";

export interface AgentProgressStep {
  /** Stable identity across renders (steps only append within a run). */
  key: string;
  label: string;
  state: AgentStepState;
}

function ProgressLoadingText({ children, className }: { children: string; className?: string }) {
  return (
    <span
      aria-label={children}
      className={cx("agent-progress-loading-text inline-block", className)}
    >
      {children}
    </span>
  );
}

/** Indeterminate arc spinner — real task durations are unknown, so the
 * ring spins instead of filling over a fixed clock. */
function SpinnerRing({ size = 16, strokeWidth = 2.5 }: { size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2 - 0.25;
  return (
    <motion.svg
      aria-hidden
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="shrink-0"
      animate={{ rotate: 360 }}
      transition={{ duration: 1.1, ease: "linear", repeat: Infinity }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-border-button-default)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--color-foreground-icon-secondary)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${radius * 1.9} ${radius * 4.4}`}
      />
    </motion.svg>
  );
}

function MinimizeIcon() {
  return (
    <span aria-hidden className="relative block size-5 shrink-0">
      <span className="absolute top-px left-px size-[18px] rounded-sm bg-background-quaternary-default" />
      <span className="absolute top-[13px] left-1 h-0.5 w-3 rounded-[3px] bg-foreground-icon-secondary" />
    </span>
  );
}

function CompletedStepIcon() {
  return (
    <svg aria-hidden viewBox="0 0 14 14" className="size-[15px]">
      <circle cx="7" cy="7" r="7" fill="var(--color-background-quaternary-default)" />
      <path
        d="M4 7.5 5.646 9.146a.5.5 0 0 0 .708 0L10 5.5"
        fill="none"
        stroke="var(--color-foreground-icon-secondary)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PendingStepIcon() {
  return (
    <svg aria-hidden viewBox="0 0 15 15" className="size-[15px]">
      <circle
        cx="7.5"
        cy="7.5"
        r="7"
        fill="none"
        stroke="var(--color-background-quaternary-default)"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

function CurrentStepIcon() {
  return (
    <svg aria-hidden viewBox="0 0 14 14" className="size-3.5 shrink-0">
      <path
        d="M7.47 2.47a.75.75 0 0 1 1.06 0l4.177 4.176a.5.5 0 0 1 0 .708L8.53 11.53a.75.75 0 0 1-1.06-1.06l2.72-2.72H2a.75.75 0 0 1 0-1.5h8.19L7.47 3.53a.75.75 0 0 1 0-1.06Z"
        fill="var(--color-foreground-icon-secondary)"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5">
      <rect
        x="1"
        y="1"
        width="18"
        height="18"
        rx="4"
        fill="var(--color-background-quaternary-default)"
      />
      <path
        d="M7.553 6.109a.75.75 0 0 1 .75-.75h5.907a.5.5 0 0 1 .5.5v5.906a.75.75 0 0 1-1.5 0V7.919l-5.79 5.791a.75.75 0 1 1-1.061-1.06l5.79-5.791H8.303a.75.75 0 0 1-.75-.75Z"
        fill="var(--color-foreground-icon-secondary)"
      />
    </svg>
  );
}

function AnimatedStatusLabel({ label, className }: { label: string; className?: string }) {
  return (
    <motion.span
      layout="position"
      transition={SPRING}
      className={cx("relative inline-flex min-w-0 overflow-hidden", className)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 4, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -4, filter: "blur(3px)" }}
          transition={{ duration: 0.26, ease: EASE }}
          className="block whitespace-nowrap"
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

function AnimatedStepLabel({
  label,
  complete,
  active,
}: {
  label: string;
  complete: boolean;
  active: boolean;
}) {
  return (
    <span
      className={cx(
        "relative block min-w-0 max-w-full truncate text-body-medium leading-5 transition-colors duration-300",
        complete || !active ? "text-text-secondary" : "text-text-primary",
      )}
    >
      {active ? <ProgressLoadingText>{label}</ProgressLoadingText> : label}
      <AnimatePresence>
        {complete && (
          <motion.span
            aria-hidden
            className="absolute top-1/2 right-0 left-0 h-px origin-left bg-current"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 0.8 }}
            exit={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.38, ease: EASE }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

function StepRow({
  label,
  index,
  state,
}: {
  label: string;
  index: number;
  state: AgentStepState;
}) {
  const complete = state === "complete";
  const active = state === "active";

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -4, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{
        delay: STEP_REVEAL_STAGGER_SECONDS * index,
        duration: STEP_REVEAL_DURATION_SECONDS,
        ease: EASE,
        layout: SPRING,
      }}
      className="h-8 w-full"
    >
      <div
        className={cx(
          "relative flex h-full w-full items-center gap-2 rounded-full transition-[padding] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          active ? "pr-[13px] pl-[9px]" : "px-1",
        )}
      >
        {/* No shared layoutId here: real subagents run in parallel, so more
            than one row can be active at once. */}
        <AnimatePresence>
          {active && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full border border-border-button-default"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>

        <span className="relative z-10 flex size-3.5 shrink-0 items-center justify-center">
          <AnimatePresence initial={false} mode="popLayout">
            {complete ? (
              <motion.span
                key="complete"
                initial={{ opacity: 0, scale: 0.72, rotate: -18 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ duration: 0.34, ease: EASE }}
                className="absolute inset-[-0.5px]"
              >
                <CompletedStepIcon />
              </motion.span>
            ) : active ? (
              <motion.span
                key="active"
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.82 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <SpinnerRing size={14} strokeWidth={1.5} />
              </motion.span>
            ) : (
              <motion.span
                key="pending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-[-0.5px]"
              >
                <PendingStepIcon />
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <span className="relative z-10 flex min-w-0 flex-1 items-center truncate leading-5">
          <AnimatedStepLabel label={label} complete={complete} active={active} />
        </span>
      </div>
    </motion.div>
  );
}

export interface AgentProgressProps {
  /** Ordered steps with caller-owned status. */
  steps: readonly AgentProgressStep[];
  /** Header line; the caller computes it (i18n). */
  statusLabel: string;
  expandLabel?: string;
  minimizeLabel?: string;
  className?: string;
}

export function AgentProgress({
  steps,
  statusLabel,
  expandLabel = "Expand steps",
  minimizeLabel = "Minimize steps",
  className,
}: AgentProgressProps) {
  const [minimized, setMinimized] = useState(false);
  const [fastReopen, setFastReopen] = useState(false);
  const complete = steps.length > 0 && steps.every((step) => step.state === "complete");
  const currentStep = steps.find((step) => step.state === "active");
  const expandedHeight = Math.max(44, 45 + steps.length * 38);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, filter: "blur(8px)" }}
      animate={{
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
      }}
      exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
      transition={{
        opacity: { duration: 0.35, ease: EASE },
        y: { duration: 0.5, ease: EASE },
        filter: { duration: 0.4, ease: EASE },
      }}
      // Height rides a CSS transition (browser-interpolated, no per-frame JS);
      // the box resizes for real, so chat below is still pushed smoothly.
      style={{
        height: minimized ? 44 : expandedHeight,
        transition: `height ${minimized ? 0.42 : fastReopen ? MODULE_REOPEN_SECONDS : MODULE_EXPAND_SECONDS}s cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "height" && e.target === e.currentTarget && !minimized) {
          setFastReopen(false);
        }
      }}
      className={cx(
        "relative w-full max-w-full overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default shadow-xs",
        className,
      )}
      aria-live="polite"
      data-testid="agent-progress"
    >
      <AnimatePresence initial={false}>
        {!complete && (
          <motion.span
            key="persistent-progress-ring"
            className="pointer-events-none absolute top-[14px] left-[14px] z-20 flex size-4 items-center justify-center"
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.82 }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            <SpinnerRing size={16} />
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence mode="sync">
        {minimized ? (
          <motion.button
            key="minimized"
            type="button"
            data-testid="agent-progress-minimized"
            aria-label={expandLabel}
            onClick={() => {
              setFastReopen(true);
              setMinimized(false);
            }}
            initial={{ opacity: 0, filter: "blur(3px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(3px)" }}
            transition={{ duration: 0.2, delay: 0.12, ease: EASE }}
            className="group absolute inset-0 flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left"
          >
            <span className="flex min-w-0 shrink-0 items-center pl-1">
              <AnimatePresence initial={false}>
                {!complete && (
                  <motion.span
                    key="progress-ring"
                    className="flex h-4 w-6 shrink-0 origin-left items-center overflow-hidden"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scaleX: 0 }}
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                )}
              </AnimatePresence>
              <AnimatedStatusLabel
                label={statusLabel}
                className="text-body-medium text-text-secondary"
              />
            </span>

            {!complete && currentStep && (
              <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-1.5 pr-6 [mask-image:linear-gradient(to_right,#000_0%,#000_100%)] transition-[mask-image] duration-300 group-hover:[mask-image:linear-gradient(to_right,#000_0%,#000_68%,transparent_94%)]">
                <CurrentStepIcon />
                <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body-medium">
                  <ProgressLoadingText className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                    {currentStep.label}
                  </ProgressLoadingText>
                </span>
              </span>
            )}

            <span className="absolute top-1/2 right-2.5 size-5 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <ExpandIcon />
            </span>
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            data-testid="agent-progress-expanded"
            initial={{ opacity: 0, filter: "blur(3px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, filter: "blur(3px)" }}
            transition={{
              duration: fastReopen ? 0.16 : 0.22,
              ease: EASE,
            }}
            className="absolute inset-x-0 top-0 px-2.5 pt-2 pb-2.5"
            style={{ height: expandedHeight }}
          >
            <div className="pt-1">
              <div className="flex h-5 w-full items-center pl-1">
                <AnimatePresence initial={false}>
                  {!complete && (
                    <motion.span
                      key="progress-ring"
                      className="flex h-4 w-6 shrink-0 origin-left items-center overflow-hidden"
                      initial={{ opacity: 1 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, scaleX: 0 }}
                      transition={{ duration: 0.4, ease: EASE }}
                    />
                  )}
                </AnimatePresence>
                <AnimatedStatusLabel
                  label={statusLabel}
                  className="flex-1 text-body-medium text-text-secondary"
                />
                <button
                  type="button"
                  aria-label={minimizeLabel}
                  onClick={() => setMinimized(true)}
                  className="size-5 cursor-pointer rounded-sm transition-opacity duration-200 hover:opacity-80"
                >
                  <MinimizeIcon />
                </button>
              </div>

              <div className="mt-[9px] flex flex-col gap-1.5">
                {steps.map((step, index) => (
                  <StepRow key={step.key} label={step.label} index={index} state={step.state} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
