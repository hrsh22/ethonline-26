import { ImageResponse } from "next/og";

export const size = { height: 180, width: 180 };
export const contentType = "image/png";

/**
 * Generated from the brand tokens rather than committed as a bitmap, so the
 * icon cannot drift from the palette and needs no asset pipeline. Every node
 * declares its display, which the image renderer requires.
 */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#121816",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <div
        style={{
          border: "16px solid #d98724",
          borderRadius: 999,
          display: "flex",
          height: 104,
          width: 104,
        }}
      />
    </div>,
    size,
  );
}
