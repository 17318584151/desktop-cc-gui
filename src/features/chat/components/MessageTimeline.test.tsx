import { describe, expect, it } from "vitest";
import { formatDuration } from "./MessageTimeline";

describe("formatDuration", () => {
  it("returns null for null, undefined, 0, or negative values", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-100)).toBeNull();
  });

  it("formats seconds under 60 with 1 decimal place", () => {
    expect(formatDuration(500)).toBe("0.5s");
    expect(formatDuration(12340)).toBe("12.3s");
    expect(formatDuration(59900)).toBe("59.9s");
  });

  it("formats minutes and seconds for values >= 60s and < 1h", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(84000)).toBe("1m24s");
    expect(formatDuration(125000)).toBe("2m5s");
  });

  it("formats hours and minutes for values >= 1h", () => {
    expect(formatDuration(3600000)).toBe("1h");
    expect(formatDuration(3720000)).toBe("1h2m");
    expect(formatDuration(7380000)).toBe("2h3m");
  });
});

