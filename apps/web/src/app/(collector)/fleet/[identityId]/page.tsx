import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COLLECTION_SIZE } from "@orbit/config/collection-manifest";

import { CraftDetailPanel } from "@/components/fleet/craft-detail-panel";
import { applicationCopy } from "@/lib/identity";

const parseCanonicalIdentityId = (value: string) => {
  if (!/^[1-9]\d{0,3}$/u.test(value)) return undefined;
  const identityId = Number(value);
  return identityId <= COLLECTION_SIZE ? identityId : undefined;
};

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
    description: applicationCopy.craft.currentOwnerOnly,
  };
}

export default async function CraftDetailPage({
  params,
}: PageProps<"/fleet/[identityId]">) {
  const { identityId } = await params;
  const parsedIdentityId = parseCanonicalIdentityId(identityId);
  if (parsedIdentityId === undefined) notFound();
  return <CraftDetailPanel identityId={parsedIdentityId} />;
}
