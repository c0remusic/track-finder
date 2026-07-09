import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { traxsourceProvider } from "../../lib/providers/traxsource";

const fixture = readFileSync(
  join(__dirname, "../fixtures/traxsource-search.html"),
  "utf-8"
);

describe("traxsourceProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the first result row from the fixture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => fixture })
    );

    const result = await traxsourceProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Traxsource",
      status: "found",
      purchaseUrl: "https://www.traxsource.com/track/1809532/minus",
      coverUrl:
        "https://www.traxsource.com/scripts/image.php/52x52/5210c009e66df5f21140e78c61b2b97c.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
      metadata: {
        bpm: 135,
        key: "G#min",
        genre: "Techno",
        label: "Tresor Records",
      },
    });
  });

  it("returns not_found when no .trk-row is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html><body><div class=\"search-list-cont\"></div></body></html>",
      })
    );

    const result = await traxsourceProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Traxsource", status: "not_found" });
  });

  it("returns error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));

    const result = await traxsourceProvider.search("anything");

    expect(result).toEqual({ platform: "Traxsource", status: "error" });
  });
});
