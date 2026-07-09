import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "../../lib/rate-limit";

const { limitMock } = vi.hoisted(() => ({
  limitMock: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@upstash/redis", () => ({
  Redis: Object.assign(
    vi.fn().mockImplementation(() => ({})),
    { fromEnv: vi.fn().mockImplementation(() => ({})) }
  ),
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(function () {
      return { limit: limitMock };
    }),
    { slidingWindow: vi.fn() }
  ),
}));

describe("checkRateLimit", () => {
  it("returns success true when under the limit", async () => {
    const result = await checkRateLimit("1.2.3.4");
    expect(result.success).toBe(true);
  });

  it("fails open (returns success true) when the Redis call throws", async () => {
    limitMock.mockRejectedValueOnce(new Error("Failed to parse URL from /pipeline"));

    const result = await checkRateLimit("1.2.3.4");

    expect(result.success).toBe(true);
  });
});
