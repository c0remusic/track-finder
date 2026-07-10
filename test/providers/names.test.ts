import { describe, it, expect } from "vitest";
import { PROVIDER_NAMES } from "../../lib/providers/names";
import { allProviders } from "../../lib/providers";

describe("PROVIDER_NAMES", () => {
  it("matches the real provider list exactly, in the same order", () => {
    expect(allProviders.map((p) => p.name)).toEqual([...PROVIDER_NAMES]);
  });
});
