import { describe, it, expect, vi, afterEach } from "vitest";
import { bandcampProvider } from "../../lib/providers/bandcamp";

describe("bandcampProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the first track result to ProviderResult", async () => {
    const fakeResponse = {
      auto: {
        results: [
          {
            type: "t",
            name: "Minus",
            band_name: "Robert Hood",
            item_url_path: "https://roberthood.bandcamp.com/track/minus",
            img: "https://f4.bcbits.com/img/0696091404_3.jpg",
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => fakeResponse })
    );

    const result = await bandcampProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Bandcamp",
      status: "found",
      purchaseUrl: "https://roberthood.bandcamp.com/track/minus",
      coverUrl: "https://f4.bcbits.com/img/0696091404_3.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
    });
  });

  it("returns not_found when there are no track-type results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ auto: { results: [{ type: "b", name: "Some Band" }] } }),
      })
    );

    const result = await bandcampProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Bandcamp", status: "not_found" });
  });

  it("returns error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await bandcampProvider.search("anything");

    expect(result).toEqual({ platform: "Bandcamp", status: "error" });
  });

  it("returns error when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const result = await bandcampProvider.search("anything");

    expect(result).toEqual({ platform: "Bandcamp", status: "error" });
  });
});
