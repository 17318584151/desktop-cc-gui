import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));
// The auth section owns its own ipc state; CliConfigBody only places it.
vi.mock("./PiFamilyAuthSection", () => ({
  PiFamilyAuthSection: () => <div data-testid="pi-auth-section" />,
}));

import i18n from "@/lib/i18n";
import { CliConfigBody } from "./CliConfigBody";
import type { CliConfigState } from "./useCliConfig";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeCli(over: Partial<CliConfigState> = {}): CliConfigState {
  return {
    t: i18n.t,
    config: null,
    engine: "pi",
    error: null,
    notice: null,
    busy: false,
    dialog: null,
    setDialog: () => {},
    pendingDelete: null,
    setPendingDelete: () => {},
    pendingSwitch: null,
    setPendingSwitch: () => {},
    ccStatus: null,
    currentId: "",
    enabled: true,
    entries: [],
    officialActive: true,
    mutate: vi.fn(),
    activate: () => {},
    requestActivate: () => {},
    confirmSwitch: () => {},
    saveProvider: () => {},
    confirmDelete: () => {},
    syncCcSwitch: vi.fn(),
    importCcSwitchFile: vi.fn(),
    dismissCcSwitch: () => {},
    ...over,
  } as CliConfigState;
}

describe("CliConfigBody disabled overlay", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
  });

  async function render(cli: CliConfigState) {
    root = createRoot(container);
    await act(async () => root?.render(<CliConfigBody cli={cli} />));
  }

  function overlay(): HTMLElement | null {
    const text = i18n.t("settings.cliDisabledOverlay");
    const node = Array.from(container.querySelectorAll("p")).find(
      (p) => p.textContent === text,
    );
    return (node?.parentElement as HTMLElement) ?? null;
  }

  it("disabled: overlay wrapper contains official config, auth and channels — but not the enable switch", async () => {
    await render(makeCli({ enabled: false }));

    const mask = overlay();
    expect(mask).not.toBeNull();
    const wrapper = mask!.parentElement!;
    // The mask is absolutely positioned over the wrapper, not inside a card.
    expect(mask!.className).toContain("absolute");
    expect(mask!.className).toContain("inset-0");

    // Everything below the enable switch is under the mask.
    expect(wrapper.textContent).toContain(i18n.t("settings.cliOfficial"));
    expect(wrapper.querySelector("[data-testid='pi-auth-section']")).not.toBeNull();
    expect(wrapper.textContent).toContain(i18n.t("settings.cliChannels"));

    // The enable switch sits above the mask, still reachable.
    const enableTitle = i18n.t("settings.cliEnableTitle", { name: "PI CLI" });
    expect(wrapper.textContent).not.toContain(enableTitle);
    expect(container.textContent).toContain(enableTitle);
  });

  it("enabled: no overlay is rendered", async () => {
    await render(makeCli({ enabled: true }));
    expect(overlay()).toBeNull();
  });
});
