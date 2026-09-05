import { describe, expect, it } from "vitest";

import {
  clearAdminSessionCookie,
  readAdminSessionHandle,
  serializeAdminSessionCookie,
} from "../src/admin-session-cookie.js";

const handle = "ab".repeat(32);

describe("admin session cookie", () => {
  it("reads only one exact, well-formed opaque handle", () => {
    expect(
      readAdminSessionHandle(
        `unrelated=secret; orbit_admin_session=${handle}; another=value`,
      ),
    ).toBe(handle);
    expect(readAdminSessionHandle(undefined)).toBeUndefined();
    expect(readAdminSessionHandle("orbit_admin_session=short")).toBeUndefined();
    expect(
      readAdminSessionHandle(
        `orbit_admin_session=${handle}; orbit_admin_session=${"cd".repeat(32)}`,
      ),
    ).toBeUndefined();
  });

  it("sets a host-only Strict HttpOnly production cookie", () => {
    expect(
      serializeAdminSessionCookie({
        appOrigin: "https://app.orbit.example",
        expiresAt: new Date("2026-08-31T08:15:00.000Z"),
        handle,
        issuedAt: new Date("2026-08-31T08:00:00.000Z"),
      }),
    ).toBe(
      `orbit_admin_session=${handle}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900; Expires=Mon, 31 Aug 2026 08:15:00 GMT; Secure`,
    );
  });

  it("omits Secure only for loopback HTTP and clears with matching attributes", () => {
    expect(
      serializeAdminSessionCookie({
        appOrigin: "http://127.0.0.1:3000",
        expiresAt: new Date("2026-08-31T08:15:00.000Z"),
        handle,
        issuedAt: new Date("2026-08-31T08:00:00.000Z"),
      }),
    ).not.toContain("Secure");
    expect(clearAdminSessionCookie("https://app.orbit.example")).toBe(
      "orbit_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure",
    );
    expect(clearAdminSessionCookie("http://localhost:3000")).not.toContain(
      "Secure",
    );
  });

  it.each([
    "http://app.orbit.example",
    "ftp://localhost",
    "https://user:secret@app.orbit.example",
  ])("rejects an unsafe cookie origin %s", (origin) => {
    expect(() => clearAdminSessionCookie(origin)).toThrow();
  });
});
