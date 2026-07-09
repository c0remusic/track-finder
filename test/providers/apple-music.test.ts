import { describe, it, expect, vi, afterEach } from "vitest";
import { appleMusicProvider } from "../../lib/providers/apple-music";

describe("appleMusicProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a found track to ProviderResult", async () => {
    const fakeResponse = {
      resultCount: 1,
      results: [
        {
          artistName: "Robert Hood",
          trackName: "Minus",
          trackViewUrl: "https://music.apple.com/us/album/minus/1621738221?i=1621738415&uo=4",
          artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
          primaryGenreName: "Electronic",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      })
    );

    const result = await appleMusicProvider.search("Robert Hood Minus");

    expect(result).toEqual({
      platform: "Apple Music",
      status: "found",
      purchaseUrl: "https://music.apple.com/us/album/minus/1621738221?i=1621738415&uo=4",
      coverUrl: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
      matchedArtist: "Robert Hood",
      matchedTitle: "Minus",
      metadata: { genre: "Electronic" },
    });
  });

  it("returns not_found when resultCount is 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ resultCount: 0, results: [] }),
      })
    );

    const result = await appleMusicProvider.search("asdkjaskdjaskdj");

    expect(result).toEqual({ platform: "Apple Music", status: "not_found" });
  });

  it("returns error when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );

    const result = await appleMusicProvider.search("anything");

    expect(result).toEqual({ platform: "Apple Music", status: "error" });
  });
});
