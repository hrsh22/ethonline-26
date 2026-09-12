import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Barlow: () => ({ variable: "font-barlow" }),
  IBM_Plex_Mono: () => ({ variable: "font-plex-mono" }),
  JetBrains_Mono: () => ({ variable: "font-mono" }),
}));

vi.mock("@/providers/wallet-provider", () => ({
  WalletProvider: ({ children }: { readonly children: React.ReactNode }) =>
    children,
}));

import RootLayout from "./layout";
import NotFound from "./not-found";
import GlobalNotFound, {
  metadata as globalNotFoundMetadata,
} from "./global-not-found";
import { metadata as routeNotFoundMetadata } from "./not-found";
import { identity } from "@/lib/identity";

describe("root document layout", () => {
  it("lets Next.js neutralize smooth scrolling during route navigation", () => {
    const html = renderToStaticMarkup(
      <RootLayout params={Promise.resolve({})}>
        <main>Route content</main>
      </RootLayout>,
    );

    expect(html).toMatch(/<html[^>]*data-scroll-behavior="smooth"/u);
  });

  it("shares identity-derived metadata between both not-found entry points", () => {
    expect(globalNotFoundMetadata).toMatchObject(routeNotFoundMetadata);
    expect(globalNotFoundMetadata.description).toContain(identity.brand);
  });

  it("uses route content inside the inherited shell and a standalone global recovery shell", () => {
    const routeHtml = renderToStaticMarkup(<NotFound />);
    const globalHtml = renderToStaticMarkup(<GlobalNotFound />);

    expect(routeHtml).not.toContain('data-shell="collector"');
    expect(routeHtml).toContain("Search the collection");
    expect(globalHtml).toContain('data-shell="collector"');
    expect(globalHtml).toContain('href="#main-content"');
    expect(globalHtml).toContain('href="/fleet"');
    expect(globalHtml).toContain('href="/learn"');
    expect(globalHtml).toMatch(
      /class="[^"]*min-h-11[^"]*"[^>]*href="\/fleet"/u,
    );
    expect(globalHtml).toContain("Search the collection");
  });
});
