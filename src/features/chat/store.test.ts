import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "./store";
import { OPEN_TABS_KEY } from "./store/persistence";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";

function resetStore() {
  localStorage.clear();
  vi.mocked(ipc.sendMessage).mockClear();
  vi.mocked(ipc.interruptSession).mockClear();
  useChatStore.setState({
    openTabs: [],
    active: null,
    activeEngine: "claude",
    models: { omp: "kimi-k3" },
    efforts: {},
    bySession: {},
    streamingByKey: {},
    unseen: {},
    drafts: {},
  });
}

describe("per-session composer selection", () => {
  beforeEach(resetStore);

  it("switching to an existing session retargets the picker to its engine", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    await useChatStore.getState().selectSession("claude", "s-1", WS);
    expect(useChatStore.getState().activeEngine).toBe("claude");
  });

  it("setModel/setEffort stamp the active tab and persist with it", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    useChatStore.getState().startNewChat(WS); // pending omp tab
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    await useChatStore.getState().setEffort("omp", "max");

    const s = useChatStore.getState();
    expect(s.active?.model).toBe("fufei/kimi-k3");
    expect(s.active?.effort).toBe("max");
    // Overrides persist with the tab list (survive restart).
    const persisted = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) ?? "[]");
    expect(persisted[0]).toMatchObject({
      model: "fufei/kimi-k3",
      effort: "max",
    });
  });

  it("re-selecting a session keeps its stamped overrides", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    // Simulate the tab gaining a native session id after the first turn.
    const stamped = { ...useChatStore.getState().active!, sessionId: "s-9" };
    useChatStore.setState({ openTabs: [stamped], active: null });

    await useChatStore.getState().selectSession("omp", "s-9", WS);
    expect(useChatStore.getState().active).toMatchObject({
      model: "fufei/kimi-k3",
    });
  });

  it("send uses the tab override over the engine default", async () => {
    useChatStore.setState({ activeEngine: "omp", models: { omp: "kimi-k3" } });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    await useChatStore.getState().setEffort("omp", "low");

    await useChatStore.getState().send("hi", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "omp",
        model: "fufei/kimi-k3",
        effort: "low",
      }),
    );
  });

  it("a tab without overrides sends with the engine default", async () => {
    useChatStore.setState({ activeEngine: "omp", models: { omp: "kimi-k3" } });
    useChatStore.getState().startNewChat(WS);

    await useChatStore.getState().send("hi", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "kimi-k3", effort: null }),
    );
  });

  it("retargeting a pending tab to another engine drops the old overrides", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    await useChatStore.getState().setEffort("omp", "max");

    useChatStore.getState().setActiveEngine("claude");
    const s = useChatStore.getState();
    expect(s.active?.engine).toBe("claude");
    expect(s.active?.model).toBeUndefined();
    expect(s.active?.effort).toBeUndefined();
  });
});

describe("stop during an in-flight send", () => {
  beforeEach(resetStore);

  it("kills the run when Stop is pressed before sendMessage resolves", async () => {
    // Existing resumed session: the tab already carries a native id, so the
    // send takes the run-routing branch (no id adoption).
    const tab = { engine: "omp", sessionId: "sess-42", workspacePath: WS };
    useChatStore.setState({ activeEngine: "omp", openTabs: [tab], active: tab });

    // Hold sendMessage open so Stop lands while the invoke is still pending —
    // exactly the window where runRouting has no entry for this run yet.
    const { promise, resolve: resolveSend } = Promise.withResolvers<{
      runId: string;
      sessionId: string | null;
    }>();
    vi.mocked(ipc.sendMessage).mockReturnValueOnce(promise);

    const sending = useChatStore.getState().send("hello", []);
    // User presses Stop mid-flight.
    await useChatStore.getState().interrupt();
    expect(useChatStore.getState().bySession["omp/sess-42"]?.interrupted).toBe(
      true,
    );
    // The stop could not have killed anything yet: no run id existed.
    expect(vi.mocked(ipc.interruptSession)).not.toHaveBeenCalledWith("run-9");

    resolveSend({ runId: "run-9", sessionId: null });
    await sending;

    // sendPrompt saw the interrupted flag once the ids materialized and
    // killed the run that Stop could not reach.
    expect(vi.mocked(ipc.interruptSession)).toHaveBeenCalledWith("run-9");
  });
});
