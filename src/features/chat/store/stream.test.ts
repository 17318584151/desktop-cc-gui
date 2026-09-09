import { describe, expect, it } from "vitest";
import { appendToolMessage, applyStreamParts, EMPTY_SESSION, type BySessionSlice } from "./stream";

function harness() {
  let state: BySessionSlice = { bySession: { k: { ...EMPTY_SESSION, messages: [] } } };
  const set = (fn: (s: BySessionSlice) => Partial<BySessionSlice>) => {
    state = { ...state, ...fn(state) };
  };
  return {
    set,
    messages: () => state.bySession.k.messages,
  };
}

describe("appendToolMessage", () => {
  it("stores args on a new tool row", () => {
    const h = harness();
    appendToolMessage(h.set, "k", "Read", null, "src/a.ts", null, { file_path: "src/a.ts" });
    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]).toMatchObject({
      role: "tool",
      text: "Read",
      path: "src/a.ts",
      args: { file_path: "src/a.ts" },
    });
  });

  it("patches the oldest args-less tool row of the same name", () => {
    const h = harness();
    appendToolMessage(h.set, "k", "Read", null);
    appendToolMessage(h.set, "k", "Read", null);
    appendToolMessage(h.set, "k", "Read", null, "src/a.ts", null, { file_path: "src/a.ts" }, true);
    expect(h.messages()).toHaveLength(2);
    expect(h.messages()[0].args).toEqual({ file_path: "src/a.ts" });
    expect(h.messages()[0].path).toBe("src/a.ts");
    expect(h.messages()[1].args).toBeUndefined();
  });

  it("drops a patch when no matching args-less row exists", () => {
    const h = harness();
    appendToolMessage(h.set, "k", "Read", null, "src/a.ts", null, { file_path: "src/a.ts" });
    appendToolMessage(h.set, "k", "Read", null, "src/b.ts", null, { file_path: "src/b.ts" }, true);
    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0].path).toBe("src/a.ts");
  });

  it("stamps model and effort on assistant stream messages", () => {
    const out = applyStreamParts([], [{ kind: "delta", text: "hello" }], "gemini-3.8-flash", "high");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      role: "assistant",
      text: "hello",
      model: "gemini-3.8-flash",
      effort: "high",
    });
  });
});
