import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beatportProvider } from "../../lib/providers/beatport";

const fixtureData = readFileSync(
  join(__dirname, "../fixtures/beatport-search.json"),
  "utf-8"
);
const fixtureHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">${fixtureData}</script></body></html>`;

describe("beatportProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the first track from the embedded __NEXT_DATA__ JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => fixtureHtml })
    );

    const result = await beatportProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Beatport",
      status: "found",
      purchaseUrl: "https://www.beatport.com/track/robert-hood/4196748",
      coverUrl:
        "https://geo-media.beatport.com/image_size/1500x250/73e8eb9b-43e3-4810-9a55-47c20f0d2f54.png",
      matchedArtist: "Robert Hood",
      matchedTitle: "Robert Hood",
      metadata: {
        bpm: 133,
        key: "B Minor",
        genre: "Minimal / Deep Tech",
        label: "Telegraph",
      },
    });
  });

  it("returns not_found when __NEXT_DATA__ has zero tracks", async () => {
    const emptyHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"tracks":{"data":[]}}}}]}}}}</script></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => emptyHtml })
    );

    const result = await beatportProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Beatport", status: "not_found" });
  });

  it("returns error when __NEXT_DATA__ is missing entirely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "<html></html>" })
    );

    const result = await beatportProvider.search("anything");

    expect(result).toEqual({ platform: "Beatport", status: "error" });
  });
});
