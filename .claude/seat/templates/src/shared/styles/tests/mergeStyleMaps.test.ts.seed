import { describe, expect, it } from "vitest";

import { mergeStyleMaps } from "../mergeStyleMaps";

type Cls = Record<string, string>;

describe("mergeStyleMaps", () => {
  it("concatenates class strings per key, later maps appended", () => {
    const own: Cls = { track: "own_track", slide: "own_slide" };
    const user: Cls = { track: "user_track" };
    const merged = mergeStyleMaps(own, user);
    expect(merged.track).toBe("own_track user_track");
    expect(merged.slide).toBe("own_slide");
  });

  it("keeps a key present in only one map", () => {
    const merged = mergeStyleMaps<Cls>({ a: "x" }, { b: "y" });
    expect(merged).toEqual({ a: "x", b: "y" });
  });

  it("skips null / undefined maps and empty values", () => {
    const merged = mergeStyleMaps<Cls>({ a: "x" }, null, undefined, {
      a: "",
      b: "y",
    });
    expect(merged).toEqual({ a: "x", b: "y" });
  });

  it("returns an empty map when nothing is provided", () => {
    expect(mergeStyleMaps()).toEqual({});
  });

  it("does not mutate the inputs", () => {
    const own: Cls = { track: "own" };
    mergeStyleMaps(own, { track: "extra" });
    expect(own).toEqual({ track: "own" });
  });
});
