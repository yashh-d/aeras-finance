import { describe, expect, it } from "vitest";

import { relativeTime } from "./format";

const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);

describe("relativeTime", () => {
  it("steps from minutes to hours to days to a date", () => {
    expect(relativeTime(NOW - 30_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
    expect(relativeTime(NOW - 10 * 86_400_000, NOW)).toMatch(/^Aug 31$/);
  });

  it("never reports a future time", () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe("just now");
  });
});
