import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";
import { CraftArt } from "@/components/ui/craft-art";
import { SpacecraftDrawing } from "@/components/ui/spacecraft-art";
import { parseCanonicalIdentityId } from "@/lib/identity-route";
import { deploymentEnvironment } from "@/lib/deployment";
import { identity } from "@/lib/identity";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Orbit collectible identity. Open its page for current ownership and state.";
export const revalidate = 86400;

export default async function IdentityImage({
  params,
}: {
  params: Promise<{ identityId: string }>;
}) {
  const id = parseCanonicalIdentityId((await params).identityId);
  if (id === undefined) notFound();
  const entry = collectionManifestArtifact.entries[id - 1]!;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#0b111b",
        color: "#ededeb",
        padding: 64,
        alignItems: "center",
        gap: 56,
      }}
    >
      <div style={{ display: "flex", width: 350, height: 420 }}>
        {id <= 4440 ? (
          <SpacecraftDrawing
            identityId={id}
            permanent={false}
            rewardTrack={identity.rewardTrackLabels[entry.track] ?? ""}
            instanceId="social-craft"
          />
        ) : (
          <CraftArt identityId={id} kind="relic" lit={false} />
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          width: 650,
        }}
      >
        <div style={{ display: "flex", color: "#ff701e", fontSize: 28 }}>
          {identity.brand}
        </div>
        <div style={{ display: "flex", fontSize: 68 }}>Identity #{id}</div>
        <div style={{ display: "flex", fontSize: 30 }}>
          {entry.track === 0
            ? id === 4444
              ? identity.terms.indicatorRelic
              : identity.terms.basketRelic
            : `${identity.rewardTrackLabels[entry.track]} · Tier ${identity.rarityTierLabels[entry.tier]}`}
        </div>
        <div style={{ display: "flex", color: "#b4b5b0", fontSize: 24 }}>
          Discover the identity. Make it your own.
        </div>
        <div style={{ display: "flex", color: "#b4b5b0", fontSize: 22 }}>
          {deploymentEnvironment.chainLabel} · Valueless test assets
        </div>
      </div>
    </div>,
    size,
  );
}
