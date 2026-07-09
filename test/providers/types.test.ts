import { describe, it, expect } from "vitest";
import type { Provider, ProviderResult } from "../../lib/providers/types";

describe("Provider contract", () => {
  it("a minimal provider satisfies the Provider type", async () => {
    const fake: Provider = {
      name: "Fake",
      async search(query: string): Promise<ProviderResult> {
        return { platform: "Fake", status: "not_found" };
      },
    };
    const result = await fake.search("test");
    expect(result.status).toBe("not_found");
    expect(result.platform).toBe("Fake");
  });
});
