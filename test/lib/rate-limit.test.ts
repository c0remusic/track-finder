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

  it("bounds requests via an in-memory fallback once Redis is down for a run of calls", async () => {
    const ip = "9.9.9.9";
    limitMock.mockRejectedValue(new Error("Upstash outage"));

    const results = [];
    for (let i = 0; i < 21; i++) {
      results.push((await checkRateLimit(ip)).success);
    }

    // First 20 calls within the window pass the in-memory fallback; the
    // 21st is over the same 20-per-60s ceiling the Redis limiter enforces.
    expect(results.slice(0, 20)).toEqual(Array(20).fill(true));
    expect(results[20]).toBe(false);
  });
});
