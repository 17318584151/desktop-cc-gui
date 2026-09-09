import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Side-effect import: initializes the i18next instance useTranslation reads.
import i18n from "@/lib/i18n";

// Minimal stubs: the status bar polls ipc.appMetrics / rescanSessions and
// subscribes via listenScanProgress; none of that is under test here.
vi.mock("@/lib/ipc", () => ({
  ipc: {
    appMetrics: vi.fn(() => Promise.withResolvers<unknown>().promise),
    rescanSessions: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/lib/events", () => ({
  listenScanProgress: vi.fn(() => Promise.resolve(() => {})),
}));

// Web fallback paths would open a real WebSocket bridge in jsdom; stub them.
vi.mock("@/lib/platform", () => ({
  isWeb: true,
  getAppVersion: vi.fn(() => Promise.resolve(null)),
  setWebviewZoom: vi.fn(),
}));

import { AppStatusBar } from "./app-status-bar";
import { statusBarRegistry } from "@ccgui/plugin-sdk";
import type { Disposer } from "@ccgui/plugin-sdk";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AppStatusBar plugin items (plan §4.2 #8)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const disposers: Disposer[] = [];

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<AppStatusBar />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      while (disposers.length) disposers.pop()!();
      root.unmount();
    });
    container.remove();
  });

  it("renders a registered StatusBarItemDef and removes it on dispose", async () => {
    // Registration notifies useRegistry subscribers synchronously; wrapping
    // the write in act flushes the resulting re-render.
    await act(async () => {
      disposers.push(
        statusBarRegistry.register({
          id: "plugin:test-plugin:chip",
          component: () => <span>PLUGIN CHIP</span>,
        }),
      );
    });
    expect(container.textContent).toContain("PLUGIN CHIP");

    await act(async () => {
      disposers.pop()!();
    });
    expect(container.textContent).not.toContain("PLUGIN CHIP");
  });

  it("orders chips by their order field", async () => {
    await act(async () => {
      disposers.push(
        statusBarRegistry.register({
          id: "plugin:a:late",
          order: 20,
          component: () => <span>LATE</span>,
        }),
        statusBarRegistry.register({
          id: "plugin:b:early",
          order: 1,
          component: () => <span>EARLY</span>,
        }),
      );
    });
    const text = container.textContent ?? "";
    expect(text.indexOf("EARLY")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("EARLY")).toBeLessThan(text.indexOf("LATE"));
  });

  it("a crashing chip unmounts itself without taking down the rest of the bar", async () => {
    // The boundary and React both console.error on a caught render crash.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => {
        disposers.push(
          statusBarRegistry.register({
            id: "plugin:crasher",
            component: () => {
              throw new Error("boom");
            },
          }),
        );
      });
      // Builtin items still render (metrics label); the crashed chip is gone.
      expect(container.textContent).toContain(i18n.t("statusbar.performance"));
      expect(container.firstElementChild).not.toBeNull();
    } finally {
      silence.mockRestore();
    }
  });
});
