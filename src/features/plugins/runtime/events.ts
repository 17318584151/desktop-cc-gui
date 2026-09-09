import { listenEngineEvents } from "@/lib/events";
import type { Disposer } from "@ccgui/plugin-sdk";

/**
 * Plugin event bus (plan §5.2 ctx.events). Carries host→plugin topics (e.g.
 * `usage://updated`, bridged from engine events below) and plugin↔plugin
 * topics. Delivery is synchronous; listener errors are isolated so one bad
 * plugin can't break the bus for others.
 */
type Listener = (data: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export const pluginBus = {
  on(topic: string, cb: Listener): Disposer {
    let set = listeners.get(topic);
    if (!set) {
      set = new Set();
      listeners.set(topic, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) listeners.delete(topic);
    };
  },

  emit(topic: string, data: unknown): void {
    const set = listeners.get(topic);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(data);
      } catch (error) {
        console.error(`[plugins] listener on "${topic}" threw`, error);
      }
    }
  },
};

/** Topic plugins subscribe to for live token-usage snapshots (plan §5.2). */
export const USAGE_UPDATED_TOPIC = "usage://updated";

/** Host→plugin topic carrying the composer's in-progress draft (plan §5.2). */
export const COMPOSER_DRAFT_TOPIC = "composer://draft";

/**
 * Emit-side topic namespace guard (plan §5.2): a plugin may emit only its own
 * `plugin:<id>:*` topics and shared `plugin-`-prefixed topics (e.g.
 * plugin-config://changed). Host topics (usage://updated, composer://draft)
 * and other plugins' `plugin:<otherId>:*` namespaces throw — emit is
 * broadcast, so cross-namespace writes would let one plugin impersonate the
 * host or spam a sibling.
 */
export function assertPluginEmitTopic(pluginId: string, topic: string): void {
  if (topic.startsWith(`plugin:${pluginId}:`) || topic.startsWith("plugin-")) return;
  throw new Error(
    `[plugins] "${pluginId}" may not emit topic "${topic}" (allowed: plugin:${pluginId}:* or shared plugin-*)`,
  );
}

let bridged = false;

/**
 * Re-emit engine `usage` events onto the plugin bus. Bound once at plugin
 * bootstrap; plugins never touch the raw engine stream (they have no invoke).
 */
export function bridgeUsageEvents(): void {
  if (bridged) return;
  bridged = true;
  void listenEngineEvents((batch) => {
    for (const event of batch) {
      if (event.kind === "usage") pluginBus.emit(USAGE_UPDATED_TOPIC, event);
    }
  });
}
