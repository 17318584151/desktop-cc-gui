import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentThinking } from "./agent-thinking";

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentThinking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders label and timer correctly", () => {
    act(() => {
      root.render(
        <AgentThinking
          label="响应中"
          startedAt={Date.now() - 5000}
        />,
      );
    });

    expect(container.textContent).toContain("响应中");
    expect(container.textContent).toMatch(/\d+\.\d+s/);
  });

  it("applies custom durationFormatter", () => {
    act(() => {
      root.render(
        <AgentThinking
          label="响应中"
          startedAt={Date.now() - 5000}
          durationFormatter={(d) => `耗时 ${d}`}
        />,
      );
    });

    expect(container.textContent).toContain("响应中");
    expect(container.textContent).toMatch(/耗时 \d+\.\d+s/);
  });

  it("renders model and effort with separator", () => {
    act(() => {
      root.render(
        <AgentThinking
          label="响应中"
          startedAt={Date.now() - 65000}
          durationFormatter={(d) => `耗时 ${d}`}
          model="模型 gemini-3.8-flash"
          effort="推理档位 high"
        />,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("响应中");
    expect(text).toContain("耗时 1m5s");
    expect(text).toContain("模型 gemini-3.8-flash");
    expect(text).toContain("推理档位 high");
    expect(text).toContain("·");
  });
});
