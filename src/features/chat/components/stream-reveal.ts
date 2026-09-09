/** Presentation-only cursor: stored messages always retain the complete text.
 * New text catches up within one short animation; done/hidden/reduced-motion
 * paths bypass animation. A timer also catches up when rAF is suspended.
 */
export interface RevealClock {
  now(): number;
  frame(callback: () => void): number;
  cancelFrame(id: number): void;
  timeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}
const browserClock: RevealClock = {
  now: () => performance.now(),
  frame: callback => requestAnimationFrame(callback),
  cancelFrame: id => cancelAnimationFrame(id),
  timeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: id => clearTimeout(id),
};
export class StreamReveal {
  private text = "";
  private visible: number;
  private from = 0;
  private started = 0;
  private lastFrame = 0;
  private frame: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<{ start: number; end: number; notify: () => void }>();
  private clock: RevealClock;
  constructor(live: boolean, clock: RevealClock = browserClock) {
    this.clock = clock;
    this.visible = live ? 0 : Infinity;
  }
  read(start: number, length: number) {
    return Math.max(0, Math.min(length, this.visible - start));
  }
  subscribe(start: number, length: number, notify: () => void) {
    const listener = { start, end: start + length, notify };
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish(next: number) {
    const previous = this.visible;
    this.visible = next;
    if (next === previous) return;
    for (const listener of this.listeners) {
      if (next < previous || (listener.end > previous && listener.start < next)) listener.notify();
    }
  }
  update(text: string, animate: boolean) {
    const append = text.startsWith(this.text);
    this.text = text;
    if (!animate || !append || this.visible === Infinity) {
      this.finish();
      return;
    }
    if (this.visible >= text.length) return;
    if (this.frame !== undefined) this.clock.cancelFrame(this.frame);
    this.from = this.visible;
    this.started = this.clock.now();
    const tick = () => {
      this.frame = undefined;
      this.lastFrame = this.clock.now();
      const fraction = Math.min(1, (this.clock.now() - this.started) / 80);
      this.publish(Math.floor(this.from + (this.text.length - this.from) * fraction));
      if (fraction < 1) this.frame = this.clock.frame(tick);
      else this.cancel();
    };
    this.frame = this.clock.frame(tick);
    if (this.timer === undefined) {
      this.lastFrame = this.started;
      const watchdog = () => {
        this.timer = undefined;
        const idle = this.clock.now() - this.lastFrame;
        if (idle >= 100) this.finish();
        else this.timer = this.clock.timeout(watchdog, 100 - idle);
      };
      this.timer = this.clock.timeout(watchdog, 100);
    }
  }
  finish() {
    this.cancel();
    this.publish(this.text.length);
  }
  cancel() {
    if (this.frame !== undefined) this.clock.cancelFrame(this.frame);
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.frame = undefined;
    this.timer = undefined;
  }
}

const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
/** Never show half an emoji, combining sequence, or surrogate pair. */
export function visiblePrefix(text: string, count: number) {
  if (count >= text.length) return text;
  if (count <= 0) return "";
  // Query just the boundary at the cursor instead of walking the entire
  // growing paragraph on every animation frame.
  const segments = segmenter?.segment(text);
  // Older webviews can still display complete text without corrupting emoji.
  if (!segments || typeof segments.containing !== "function") return text;
  const segment = segments.containing(count);
  return text.slice(0, segment?.index ?? text.length);
}

/** Window follows the revealed cursor, not the received tail, so a large
 * thinking chunk cannot hide all content while the cursor catches up. */
export function visibleWindow(text: string, count: number, limit: number) {
  const prefix = visiblePrefix(text, count);
  if (prefix.length <= limit) return prefix;
  const start = prefix.length - limit;
  const segments = segmenter?.segment(prefix);
  const boundary = segments?.containing?.(start)?.index ?? start;
  return prefix.slice(boundary);
}
