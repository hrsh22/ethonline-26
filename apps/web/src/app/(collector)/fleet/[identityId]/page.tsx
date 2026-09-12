import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseCanonicalIdentityId } from "@/lib/identity-route";
import { CraftSharing } from "@/components/fleet/craft-sharing";
import { identity } from "@/lib/identity";

import { CraftDetailPanel } from "@/components/fleet/craft-detail-panel";
import { applicationCopy } from "@/lib/identity";
import { collectionReturnTarget } from "@/lib/collection-return-target";

export async function generateMetadata({
  params,
}: PageProps<"/fleet/[identityId]">): Promise<Metadata> {
  const { identityId } = await params;
  const parsedIdentityId = parseCanonicalIdentityId(identityId);
  return {
    title:
      parsedIdentityId === undefined
        ? applicationCopy.fleet.title
        : applicationCopy.craft.title(parsedIdentityId),
    description: `${identity.brand} identity #${parsedIdentityId ?? "unknown"}. Explore its assigned traits and current onchain state.`,
  };
}

export default async function CraftDetailPage({
  params,
  searchParams,
}: PageProps<"/fleet/[identityId]">) {
  const { identityId } = await params;
  const parsedIdentityId = parseCanonicalIdentityId(identityId);
  if (parsedIdentityId === undefined) notFound();
  return (
    <>
      <CraftDetailPanel
        identityId={parsedIdentityId}
        backHref={collectionReturnTarget((await searchParams) ?? {})}
      />
      <CraftSharing identityId={parsedIdentityId} />
    </>
  );
}
