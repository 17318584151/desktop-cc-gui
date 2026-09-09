import { memo, useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import { StreamReveal, visiblePrefix, visibleWindow } from "./stream-reveal";

/** Only the text runs crossing the reveal cursor rerender each frame.
 * Markdown parsing, code highlighting and the timeline stay out of this loop.
 */
export const RevealText = memo(function RevealText({ controller, start, children, windowSize }: {
  controller: StreamReveal;
  start: number;
  children: string;
  windowSize?: number;
}) {
  const subscribe = useCallback((notify: () => void) => controller.subscribe(start, children.length, notify), [controller, start, children.length]);
  const snapshot = useCallback(() => controller.read(start, children.length), [controller, start, children.length]);
  const count = useSyncExternalStore(subscribe, snapshot, () => children.length);
  return <span>{windowSize ? visibleWindow(children, count, windowSize) : visiblePrefix(children, count)}</span>;
});

/** Plain streaming text (thinking) shares the frame cursor without parsing
 * Markdown. The whole stored text is retained; only its displayed window moves. */
export function SmoothThinkingText({ text }: { text: string }) {
  const [controller] = useState(() => new StreamReveal(false));
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    controller.update(text, !reducedMotion && !document.hidden);
  }, [controller, text, reducedMotion]);
  useLayoutEffect(() => {
    const onVisibility = () => { if (document.hidden) controller.finish(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.cancel();
    };
  }, [controller]);
  return <RevealText controller={controller} start={0} windowSize={2000}>{text}</RevealText>;
}
