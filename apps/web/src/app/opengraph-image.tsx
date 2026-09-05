import { ImageResponse } from "next/og";

import { deploymentEnvironment } from "@/lib/deployment";
import { identity } from "@/lib/identity";

export const size = { height: 630, width: 1200 };
export const contentType = "image/png";
export const alt = `${identity.brand} — ${identity.copy.metadataDescription}`;

/**
 * The shared social card. Generated from the brand tokens and the identity
 * copy so a shared link says the same thing the application does. Every node
 * declares its display, which the image renderer requires.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#121816",
        color: "#eef1ef",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: 72,
        width: "100%",
      }}
    >
      <div
        style={{
          color: "#d98724",
          display: "flex",
          fontSize: 26,
          letterSpacing: 8,
        }}
      >
        {deploymentEnvironment.chainLabel}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700 }}>
          {identity.brand}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            lineHeight: 1.35,
            maxWidth: 940,
          }}
        >
          {identity.copy.metadataDescription}
        </div>
      </div>
      <div style={{ color: "#d98724", display: "flex", fontSize: 24 }}>
        {identity.disclosures.testnet}
      </div>
    </div>,
    size,
  );
}
