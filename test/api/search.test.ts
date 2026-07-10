import { describe, it, expect, vi } from "vitest";
import { aggregateSearch } from "../../app/api/search/route";
import type { Provider } from "../../lib/providers/types";

function fakeProvider(overrides: Partial<Provider> & { name: string }): Provider {
  return {
    search: async () => ({ platform: overrides.name, status: "not_found" }),
    ...overrides,
  };
}

describe("aggregateSearch", () => {
  it("filters out not_found and keeps found + error in purchase list", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => ({ platform: "A", status: "found", purchaseUrl: "https://a.example/x" }),
      }),
      fakeProvider({ name: "B", search: async () => ({ platform: "B", status: "not_found" }) }),
      fakeProvider({ name: "C", search: async () => ({ platform: "C", status: "error" }) }),
    ];

    const result = await aggregateSearch("query-not-found-filter", providers);

    expect(result.purchase.map((r) => r.platform).sort()).toEqual(["A", "C"]);
  });

  it("isolates a provider that throws instead of failing the whole search", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => {
          throw new Error("boom");
        },
      }),
      fakeProvider({
        name: "B",
        search: async () => ({ platform: "B", status: "found", purchaseUrl: "https://b.example/y" }),
      }),
    ];

    const result = await aggregateSearch("query-throwing-provider", providers);

    expect(result.purchase.map((r) => r.platform).sort()).toEqual(["A", "B"]);
    expect(result.purchase.find((r) => r.platform === "A")?.status).toBe("error");
  });

  it("marks a provider that never resolves as error and still returns within the timeout budget", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "Hangs Forever",
        search: () => new Promise(() => {}), // never resolves/rejects
      }),
      fakeProvider({
        name: "B",
        search: async () => ({ platform: "B", status: "found", purchaseUrl: "https://b.example/y" }),
      }),
    ];

    const TEST_TIMEOUT_MS = 50;
    const start = Date.now();
    const result = await aggregateSearch("query-hanging-provider", providers, TEST_TIMEOUT_MS);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(TEST_TIMEOUT_MS + 500);
    expect(result.purchase.map((r) => r.platform).sort()).toEqual(["B", "Hangs Forever"]);
    expect(result.purchase.find((r) => r.platform === "Hangs Forever")?.status).toBe("error");
  });

  it("invokes onProviderResult once per provider, including not_found ones, on a fresh run", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => ({ platform: "A", status: "found", purchaseUrl: "https://a.example/x" }),
      }),
      fakeProvider({ name: "B", search: async () => ({ platform: "B", status: "not_found" }) }),
    ];

    const seen: string[] = [];
    await aggregateSearch("query-callback-fresh", providers, undefined, (result) => {
      seen.push(`${result.platform}:${result.status}`);
    });

    expect(seen.sort()).toEqual(["A:found", "B:not_found"]);
  });

  it("replays every stored result via onProviderResult on a cache hit", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => ({ platform: "A", status: "found", purchaseUrl: "https://a.example/x" }),
      }),
      fakeProvider({ name: "B", search: async () => ({ platform: "B", status: "not_found" }) }),
    ];

    await aggregateSearch("query-callback-cache-hit", providers);

    const seen: string[] = [];
    await aggregateSearch("query-callback-cache-hit", providers, undefined, (result) => {
      seen.push(`${result.platform}:${result.status}`);
    });

    expect(seen.sort()).toEqual(["A:found", "B:not_found"]);
  });
});
