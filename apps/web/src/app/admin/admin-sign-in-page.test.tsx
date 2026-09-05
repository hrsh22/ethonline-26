import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/admin-sign-in", () => ({
  AdminSignIn: ({ next }: { readonly next: string }) => (
    <main data-public-admin-sign-in={next}>Public operator sign-in</main>
  ),
}));

import AdminSignInPage from "./(public)/sign-in/page";

describe("public admin sign-in page", () => {
  it("stays outside the protected shell and accepts only known return routes", async () => {
    const diagnostics = renderToStaticMarkup(
      await AdminSignInPage({
        searchParams: Promise.resolve({ next: "/admin/diagnostics" }),
      }),
    );
    const attacker = renderToStaticMarkup(
      await AdminSignInPage({
        searchParams: Promise.resolve({ next: "//attacker.example" }),
      }),
    );

    expect(diagnostics).toContain(
      'data-public-admin-sign-in="/admin/diagnostics"',
    );
    expect(attacker).toContain('data-public-admin-sign-in="/admin"');
    expect(diagnostics).not.toContain('data-shell="admin"');
    expect(attacker).not.toContain("attacker.example");
  });

  it("rejects encoded, external, and near-match return paths", async () => {
    for (const next of [
      "https://attacker.example/admin",
      "//attacker.example/admin",
      "%2Fadmin%2Fdiagnostics",
      "/admin/diagnostics/",
      "/admin/diagnostics?mode=raw",
    ]) {
      const html = renderToStaticMarkup(
        await AdminSignInPage({
          searchParams: Promise.resolve({ next }),
        }),
      );

      expect(html).toContain('data-public-admin-sign-in="/admin"');
      expect(html).not.toContain("attacker.example");
    }
  });
});
