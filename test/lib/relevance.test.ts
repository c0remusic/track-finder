import { describe, it, expect } from "vitest";
import { isRelevantMatch } from "../../lib/relevance";

describe("isRelevantMatch", () => {
  it("accepts a candidate that contains the query's significant words", () => {
    expect(isRelevantMatch("Robert Hood Minus", "Robert Hood — Minus")).toBe(true);
  });

  it("accepts a candidate where artist/title are split but both present", () => {
    expect(isRelevantMatch("sven dose all in", "Sven Dose — All In (Original Mix)")).toBe(true);
  });

  it("rejects a candidate unrelated to the query (real false-positive case)", () => {
    expect(
      isRelevantMatch("sven dose all in", "Coffee Breath — All Consultants Go To Heaven")
    ).toBe(false);
  });

  it("rejects a candidate sharing only a common short word", () => {
    expect(isRelevantMatch("robert hood minus", "DJ Rush — The Godfather")).toBe(false);
  });

  it("treats an empty query as always relevant (nothing to check against)", () => {
    expect(isRelevantMatch("", "Anything At All")).toBe(true);
  });

  it("does not match a query token as a substring inside an unrelated longer word", () => {
    // "hood" must not match inside "brotherhood" — exact-token comparison,
    // not string .includes().
    expect(isRelevantMatch("Robert Hood Minus", "Brotherhood Records — Some Track")).toBe(false);
  });

  it("matches non-Latin-script queries instead of silently bypassing the check", () => {
    // An all-non-Latin query must not reduce to zero significant tokens and
    // hit the empty-query early return — that would bypass the check
    // entirely for these queries.
    expect(isRelevantMatch("坂本龍一 戦場のメリークリスマス", "坂本龍一 — 戦場のメリークリスマス")).toBe(true);
    expect(isRelevantMatch("坂本龍一 戦場のメリークリスマス", "Coffee Breath — Unrelated Track")).toBe(false);
  });
});
