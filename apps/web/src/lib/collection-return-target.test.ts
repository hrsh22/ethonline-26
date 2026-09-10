import { describe, expect, it } from "vitest";
import { collectionReturnTarget } from "./collection-return-target";

describe("collection detail origin", () => {
  it("returns public previews to Explore", () => {
    expect(collectionReturnTarget({ from: "explore" })).toBe("/explore");
  });
  it("preserves collection filters for Back navigation", () => {
    expect(
      collectionReturnTarget({
        returnTo: "/fleet?state=permanent&track=AAPLc&page=2",
      }),
    ).toBe("/fleet?state=permanent&track=AAPLc&page=2");
  });
  it.each([
    "https://evil.test/fleet?a=1",
    "//evil.test/fleet?a=1",
    "/admin",
    "/fleet/42",
    "javascript:alert(1)",
    "/fleet?x=1#hidden",
  ])("bounds the origin %s", (returnTo) => {
    expect(collectionReturnTarget({ returnTo })).toBe(
      returnTo.startsWith("/fleet?") ? "/fleet?x=1" : "/fleet",
    );
  });
  it("ignores repeated and unknown origins", () => {
    expect(
      collectionReturnTarget({
        from: ["explore", "admin"],
        returnTo: ["/fleet?x=1"],
      }),
    ).toBe("/fleet");
  });
});
