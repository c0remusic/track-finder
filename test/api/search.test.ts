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

  it("merges metadata across found providers, keeping conflicting values with their source", async () => {
    const providers: Provider[] = [
      fakeProvider({
        name: "A",
        search: async () => ({
          platform: "A",
          status: "found",
          purchaseUrl: "https://a.example/x",
          metadata: { bpm: 133 },
        }),
      }),
      fakeProvider({
        name: "B",
        search: async () => ({
          platform: "B",
          status: "found",
          purchaseUrl: "https://b.example/y",
          metadata: { bpm: 134 },
        }),
      }),
    ];

    const result = await aggregateSearch("query-metadata-merge", providers);

    expect(result.metadata.bpm).toEqual([
      { value: 133, source: "A" },
      { value: 134, source: "B" },
    ]);
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
});
