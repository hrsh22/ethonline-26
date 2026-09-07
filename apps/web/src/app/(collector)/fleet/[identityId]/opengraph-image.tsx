import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";
import { craftGeometry } from "@/components/ui/craft-art";
import { parseCanonicalIdentityId } from "@/lib/identity-route";
import { deploymentEnvironment } from "@/lib/deployment";
import { identity } from "@/lib/identity";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "Collectible identity with illustrative web artwork. Current state is available on its public page.";
export const revalidate = 86400;

export default async function IdentityImage({
  params,
}: {
  params: Promise<{ identityId: string }>;
}) {
  const id = parseCanonicalIdentityId((await params).identityId);
  if (id === undefined) notFound();
  const entry = collectionManifestArtifact.entries[id - 1]!;
  const craft = craftGeometry(id, entry.track);
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#0d0f10",
        color: "#ededeb",
        padding: 64,
        alignItems: "center",
        gap: 56,
      }}
    >
      <svg
        width="350"
        height="420"
        viewBox="0 0 120 120"
        fill="none"
        stroke="#b4b5b0"
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        {id <= 4440 ? (
          <g>
            {craft.fins.map((d, index) => (
              <path key={index} d={d} fill="#202427" />
            ))}
            <path d={craft.hull} fill="#202427" />
            {craft.ports.map((port) => (
              <circle
                key={port.y}
                cx="60"
                cy={port.y}
                r={port.r}
                fill="#ff701e"
              />
            ))}
            {craft.engines.map((engine) => (
              <rect
                key={engine.x}
                x={engine.x - engine.w / 2}
                y={craft.tail - 1}
                width={engine.w}
                height="5"
              />
            ))}
            {craft.antenna ? <path d={craft.antenna} /> : null}
          </g>
        ) : id === 4444 ? (
          <g>
            <path d="M48 22H72V86H48Z" fill="#202427" />
            <ellipse cx="60" cy="22" rx="12" ry="4" fill="#ff701e" />
            <circle cx="60" cy="54" r="5" />
            <path d="M34 100Q60 82 86 100M60 86V104M46 104H74" />
          </g>
        ) : (
          <g>
            <path d="M8 60H112M60 46V34" />
            <rect x="50" y="46" width="20" height="28" rx="2" fill="#202427" />
            <circle cx="60" cy="60" r="3.5" fill="#ff701e" />
            {Array.from({ length: (id - 4440) * 2 }, (_, index) => (
              <rect
                key={index}
                x={
                  60 +
                  (index % 2 ? 1 : -1) * (24 + Math.floor(index / 2) * 13) -
                  5
                }
                y="49"
                width="10"
                height="22"
                fill="#202427"
              />
            ))}
          </g>
        )}
      </svg>
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
          Illustrative web preview. Check current state on the public identity
          page.
        </div>
        <div style={{ display: "flex", color: "#b4b5b0", fontSize: 22 }}>
          {deploymentEnvironment.chainLabel} · Valueless test assets
        </div>
      </div>
    </div>,
    size,
  );
}
