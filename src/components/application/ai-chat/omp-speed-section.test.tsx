import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OmpSpeedSection } from "./omp-speed-section";
import { supportsOmpFastMode } from "@/lib/omp-service-tier";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let node: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
it("offers inherit/standard/Fast and saves explicit priority", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  await act(async () => root.render(<OmpSpeedSection model="openai-codex/gpt-5.4" value={null} onChange={save} />));
  const select = node.querySelector("select")!;
  expect(select.value).toBe("inherit");
  expect(Array.from(select.options, o => o.value)).toEqual(["inherit", "default", "priority"]);
  await act(async () => { select.value = "priority"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(save).toHaveBeenCalledWith("priority");
});
it("disables unsupported models without displaying remembered Fast as active", async () => {
  await act(async () => root.render(<OmpSpeedSection model="anthropic/claude" value="priority" onChange={vi.fn()} />));
  expect(node.querySelector("select")!.disabled).toBe(true);
  expect(node.querySelector("select")!.value).toBe("inherit");
  for (const model of ["", "gpt-5.4", "custom/gpt-5.4", "openai/"]) expect(supportsOmpFastMode(model)).toBe(false);
  expect(supportsOmpFastMode("openai/gpt-5.4")).toBe(true);
});
it("reports save failure and retains the previous selection", async () => {
  await act(async () => root.render(<OmpSpeedSection model="openai/gpt-5.4" value="default" onChange={vi.fn().mockRejectedValue(new Error("disk"))} />));
  await act(async () => { const s = node.querySelector("select")!; s.value = "priority"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(node.querySelector("select")!.value).toBe("default");
  expect(node.querySelector('[role="alert"]')!.textContent).toBe("chat.ompSpeedSaveError");
});
it("saving blocks duplicate changes and supports explicit off and inheritance", async () => {
  let resolve!: () => void;
  const save = vi.fn(() => new Promise<void>(r => { resolve = r; }));
  await act(async () => root.render(<OmpSpeedSection model="openai/gpt-5.4" value="priority" onChange={save} />));
  await act(async () => { const s = node.querySelector("select")!; s.value = "default"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(save).toHaveBeenCalledWith("default");
  expect(node.querySelector("select")!.disabled).toBe(true);
  await act(async () => resolve());
  await act(async () => { const s = node.querySelector("select")!; s.value = "inherit"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(save).toHaveBeenLastCalledWith(null);
  await act(async () => resolve());
});
