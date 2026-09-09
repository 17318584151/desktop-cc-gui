import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Markdown from "./Markdown";
import { markdownRegistry } from "@ccgui/plugin-sdk";
import type { Disposer } from "@ccgui/plugin-sdk";

// React's act() environment flag — a well-known global the runtime can't
// validate, so a named cast with no narrowing is the right boundary.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

/** Two-line fence so the host `pre` override renders the full CodeBlock card
 *  (single-line fences take the compact path). */
const FENCE = "```ts\nconst a = 1;\nconst b = 2;\n```";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderMarkdown(text: string) {
  await act(async () => {
    root.render(<Markdown text={text} workspacePath="/ws" />);
  });
}

describe("Markdown markdownRegistry merge (plan §4.2 #5)", () => {
  it("renders host defaults with no registrations (gfm + CodeBlock card)", async () => {
    await renderMarkdown(`~~gone~~\n\n${FENCE}`);
    // remark-gfm still active: strikethrough is a <del>.
    expect(container.querySelector("del")?.textContent).toBe("gone");
    // Host `pre` override still renders the code-block card.
    expect(container.querySelector(".md-codeblock")).not.toBeNull();
  });

  it("applies a registered plugin's component override", async () => {
    const dispose = markdownRegistry.register({
      id: "plugin:test:md",
      components: {
        code: ({ children }) => <code data-testid="plugin-code">{children}</code>,
      },
    });
    try {
      await renderMarkdown(FENCE);
      expect(container.querySelector("[data-testid='plugin-code']")).not.toBeNull();
    } finally {
      await act(async () => dispose());
    }
  });

  it("registry changes apply live to a mounted render and dispose reverts them", async () => {
    await renderMarkdown(FENCE);
    expect(container.querySelector("[data-testid='plugin-code']")).toBeNull();
    expect(container.querySelector(".md-codeblock")).not.toBeNull();

    let dispose: Disposer = () => {};
    await act(async () => {
      dispose = markdownRegistry.register({
        id: "plugin:test:md",
        components: {
          code: ({ children }) => <code data-testid="plugin-code">{children}</code>,
        },
      });
    });
    expect(container.querySelector("[data-testid='plugin-code']")).not.toBeNull();

    await act(async () => {
      dispose();
    });
    expect(container.querySelector("[data-testid='plugin-code']")).toBeNull();
    expect(container.querySelector(".md-codeblock")).not.toBeNull();
  });
});
