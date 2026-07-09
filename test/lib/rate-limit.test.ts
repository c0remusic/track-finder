import { describe, it, expect, vi } from "vitest";
import { checkRateLimit } from "../../lib/rate-limit";

vi.mock("@upstash/redis", () => ({
  Redis: Object.assign(
    vi.fn().mockImplementation(() => ({})),
    { fromEnv: vi.fn().mockImplementation(() => ({})) }
  ),
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(function () {
      return {
        limit: vi.fn().mockResolvedValue({ success: true }),
      };
    }),
    { slidingWindow: vi.fn() }
  ),
}));

describe("checkRateLimit", () => {
  it("returns success true when under the limit", async () => {
    const result = await checkRateLimit("1.2.3.4");
    expect(result.success).toBe(true);
  });
});
