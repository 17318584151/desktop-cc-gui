"use client";

import { type ComponentProps, type ReactNode } from "react";
import {
  OverlayArrow as AriaOverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
} from "react-aria-components";
import { cx } from "@/utils/cx";

/**
 * Tooltip — hover hint for truncated or icon-only content.
 *
 * Composable primitives on react-aria, same contract as Dropdown: `Tooltip`
 * wraps a trigger element (any focusable element works) and one
 * `TooltipContent`; hover/focus opens after `delay`, moving away closes
 * immediately. Never put essential copy here — it is unreachable on touch.
 */

export interface TooltipProps extends ComponentProps<typeof AriaTooltipTrigger> {}

export function Tooltip({ delay = 500, closeDelay = 0, ...props }: TooltipProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...props} />;
}

export interface TooltipContentProps
  extends Pick<ComponentProps<typeof AriaTooltip>, "placement" | "offset"> {
  children: ReactNode;
  className?: string;
}

export function TooltipContent({
  placement = "top",
  offset = 6,
  className,
  children,
}: TooltipContentProps) {
  return (
    <AriaTooltip
      placement={placement}
      offset={offset}
      className={cx(
        "max-w-[min(360px,calc(100vw-32px))] rounded-lg border border-border-button-default",
        "bg-background-primary-default px-2 py-1 shadow-dropdown",
        "text-caption-1-medium text-text-secondary",
        "transition duration-150 ease-out",
        "data-[entering]:opacity-0 data-[entering]:scale-95 data-[exiting]:opacity-0",
        "data-[placement=bottom]:origin-top data-[placement=top]:origin-bottom",
        className,
      )}
    >
      <AriaOverlayArrow>
        <svg
          viewBox="0 0 8 8"
          className="size-2 fill-background-primary-default stroke-border-button-default data-[placement=bottom]:rotate-180"
        >
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </AriaOverlayArrow>
      {children}
    </AriaTooltip>
  );
}
