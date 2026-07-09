import { describe, it, expect } from "vitest";
import { TtlCache } from "../../lib/cache";

describe("TtlCache", () => {
  it("returns a cached value before it expires", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("returns undefined after the TTL elapses", async () => {
    const cache = new TtlCache<string>(10);
    cache.set("key", "value");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get("key")).toBeUndefined();
  });
});
