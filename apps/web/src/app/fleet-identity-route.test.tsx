import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFoundMock = vi.hoisted(() =>
  vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/components/fleet/craft-detail-panel", () => ({
  CraftDetailPanel: ({ identityId }: { readonly identityId: number }) => (
    <main>Identity {identityId}</main>
  ),
}));

import CraftDetailPage, {
  generateMetadata,
} from "./(collector)/fleet/[identityId]/page";

const routeProperties = (identityId: string) => ({
  params: Promise.resolve({ identityId }),
  searchParams: Promise.resolve({}),
});

describe("canonical collectible identity route", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
  });

  it("renders a canonical decimal identity", async () => {
    const page = await CraftDetailPage(routeProperties("42"));

    expect(renderToStaticMarkup(page)).toContain("Identity 42");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("uses state-neutral metadata before the client classifies the identity", async () => {
    const metadata = await generateMetadata(routeProperties("42"));

    expect(metadata.title).toBe("ORBIT identity #42");
  });

  it.each(["0", "4445", "0042", "+42", "42.0", "4e2", " 42", "42x"])(
    "rejects the non-canonical identity segment %j",
    async (identityId) => {
      await expect(
        CraftDetailPage(routeProperties(identityId)),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("does not describe a non-canonical segment as a collectible", async () => {
    const metadata = await generateMetadata(routeProperties("0042"));

    expect(metadata.title).toBe("Fleet");
  });
});
