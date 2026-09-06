/** Deterministic web artwork. Canonical sealed metadata may use different art. */

import { useId } from "react";

export type CraftKind = "transient" | "permanent" | "relic";

/** splitmix32; the seed is avalanched so adjacent ids do not share a hull. */
const seededRandom = (seed: number): (() => number) => {
  let state = (seed + 0x9e37_79b9) | 0;
  return () => {
    state = (state + 0x9e37_79b9) | 0;
    let mixed = state ^ (state >>> 16);
    mixed = Math.imul(mixed, 0x21f0_aaad);
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x735a_2d97);
    mixed ^= mixed >>> 15;
    return (mixed >>> 0) / 4_294_967_296;
  };
};

const SIZE = 120;
const AXIS = SIZE / 2;

const pick = <T,>(random: () => number, options: readonly T[]): T =>
  options[Math.floor(random() * options.length)] as T;

const point = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** A closed polygon mirrored across the vertical axis, from a right-hand side. */
const mirrored = (right: readonly (readonly [number, number])[]): string => {
  const left = [...right].reverse().map(([dx, y]) => [-dx, y] as const);
  return `M${[...right, ...left].map(([dx, y]) => point(AXIS + dx, y)).join("L")}Z`;
};

interface Craft {
  readonly hull: string;
  readonly fins: readonly string[];
  readonly engines: readonly { readonly x: number; readonly w: number }[];
  readonly tail: number;
  readonly ports: readonly { readonly y: number; readonly r: number }[];
  readonly stripes: readonly number[];
  readonly antenna: string | undefined;
  readonly plume: string;
}

/** Pure geometry for one identity, so the component stays a plain view. */
export const craftGeometry = (identityId: number, track: number): Craft => {
  const random = seededRandom(identityId);
  const family = pick(random, ["needle", "capsule", "wedge", "tug"] as const);
  const nose = 14 + random() * 8;
  const tail = 96 + random() * 8;
  const halfWidth =
    family === "needle"
      ? 9 + random() * 3
      : family === "wedge"
        ? 16 + random() * 6
        : 13 + random() * 5;
  const shoulder = nose + (tail - nose) * (family === "wedge" ? 0.72 : 0.3);

  const hull =
    family === "capsule"
      ? mirrored([
          [0, nose],
          [halfWidth * 0.55, nose + 5],
          [halfWidth, shoulder],
          [halfWidth, tail - 10],
          [halfWidth * 0.7, tail],
          [0, tail],
        ])
      : family === "tug"
        ? mirrored([
            [0, nose],
            [halfWidth * 0.4, nose + 4],
            [halfWidth * 0.4, shoulder - 6],
            [halfWidth, shoulder],
            [halfWidth, tail - 6],
            [halfWidth * 0.8, tail],
            [0, tail],
          ])
        : mirrored([
            [0, nose],
            [halfWidth, shoulder],
            [halfWidth, tail - 4],
            [halfWidth * 0.75, tail],
            [0, tail],
          ]);

  const finCount = pick(random, [0, 2, 2, 4] as const);
  const finSpan = halfWidth + 9 + random() * 8;
  const finTop = tail - 22 - random() * 14;
  const fins: string[] = [];
  if (finCount > 0) {
    fins.push(
      mirrored([
        [halfWidth - 1, finTop],
        [finSpan, tail - 3],
        [finSpan, tail + 2],
        [halfWidth - 1, tail],
      ]),
    );
  }
  if (finCount === 4) {
    // The second pair is seen edge-on: a short spine down the hull.
    fins.push(`M${point(AXIS, finTop + 4)}L${point(AXIS, tail - 1)}`);
  }

  const engineCount = pick(random, [1, 2, 2, 3] as const);
  const engineWidth = Math.min(7, (halfWidth * 1.5) / engineCount);
  const engines = Array.from({ length: engineCount }, (_unused, index) => ({
    x: AXIS + (index - (engineCount - 1) / 2) * (engineWidth + 2),
    w: engineWidth,
  }));

  const portCount = pick(random, [1, 2, 3] as const);
  const portStart = shoulder + 4;
  const ports = Array.from({ length: portCount }, (_unused, index) => ({
    y: portStart + index * 8,
    r: family === "needle" ? 1.8 : 2.4,
  }));

  // Track is encoded as a band count, so the drawing stays monochrome and the
  // reward track is still legible without a legend.
  const stripeBase = tail - 16;
  const stripes = Array.from(
    { length: Math.max(1, Math.min(4, track)) },
    (_unused, index) => stripeBase - index * 3,
  );

  const antenna =
    random() < 0.45
      ? `M${point(AXIS, nose)}L${point(AXIS, nose - 7)}M${point(AXIS - 3, nose - 7)}L${point(AXIS + 3, nose - 7)}`
      : undefined;

  const plume = mirrored([
    [0, tail + 2],
    [halfWidth * 0.55, tail + 4],
    [halfWidth * 0.3, tail + 14 + random() * 6],
    [0, tail + 20],
  ]);

  return { hull, fins, engines, tail, ports, stripes, antenna, plume };
};

type ArtSemantics =
  | { readonly "aria-hidden": true }
  | { readonly "aria-label": string; readonly role: "img" };

/**
 * A drawing beside the identity it depicts is decoration and is hidden; a
 * standalone one is named. `role="img"` with an empty name is neither.
 */
const semanticsFor = (decorative: boolean, name: string): ArtSemantics =>
  decorative ? { "aria-hidden": true } : { "aria-label": name, role: "img" };

const kindLabel: Record<CraftKind, string> = {
  transient: "grounded craft",
  permanent: "orbiter",
  relic: "relic",
};

function OrdinaryCraft({
  identityId,
  lit,
  track,
}: {
  readonly identityId: number;
  readonly lit: boolean;
  readonly track: number;
}) {
  const craft = craftGeometry(identityId, track);
  // Several crafts share a page, so the hull clip needs a unique id.
  const clipId = useId();
  const line = lit ? "var(--text-primary)" : "var(--text-secondary)";
  const signal = "var(--accent-text)";
  return (
    <>
      {lit ? (
        <path d={craft.plume} fill={signal} opacity="0.55" stroke="none" />
      ) : null}
      {craft.fins.map((d, index) => (
        <path d={d} fill="var(--surface-1)" key={index} stroke={line} />
      ))}
      <path d={craft.hull} fill="var(--surface-2)" stroke={line} />
      <g
        clipPath={`url(#${clipId})`}
        stroke={line}
        strokeWidth="0.7"
        opacity="0.45"
      >
        <path d={`M48 18V${craft.tail}M72 18V${craft.tail}`} />
        <path d={`M30 ${craft.tail - 25}H90`} />
        <path
          d={`M54 ${craft.tail - 23}V${craft.tail - 19}H66V${craft.tail - 23}Z`}
        />
      </g>
      {craft.stripes.map((y) => (
        <line
          key={y}
          stroke={line}
          strokeWidth="1"
          x1={AXIS - 30}
          x2={AXIS + 30}
          y1={y}
          y2={y}
          clipPath={`url(#${clipId})`}
        />
      ))}
      {craft.ports.map((port) => (
        <circle
          cx={AXIS}
          cy={port.y}
          fill={lit ? signal : "none"}
          key={port.y}
          r={port.r}
          stroke={line}
        />
      ))}
      {craft.engines.map((engine) => (
        <rect
          fill={lit ? signal : "none"}
          height="5"
          key={engine.x}
          stroke={line}
          width={engine.w}
          x={engine.x - engine.w / 2}
          y={craft.tail - 1}
        />
      ))}
      {craft.antenna === undefined ? null : (
        <path d={craft.antenna} stroke={line} />
      )}
      <defs>
        <clipPath id={clipId}>
          <path d={craft.hull} />
        </clipPath>
      </defs>
    </>
  );
}

/** The three Stations: a hub with two, four or six solar arrays on a truss. */
function Station({
  variant,
  lit,
}: {
  readonly variant: 1 | 2 | 3;
  readonly lit: boolean;
}) {
  const line = "var(--text-primary)";
  const signal = lit ? "var(--accent-text)" : "var(--text-secondary)";
  const arrays = variant * 2;
  return (
    <>
      <line stroke={line} x1={18} x2={102} y1={AXIS} y2={AXIS} />
      {Array.from({ length: arrays }, (_unused, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const offset = 24 + Math.floor(index / 2) * 13;
        const y = AXIS - 11;
        return (
          <g key={index}>
            <rect
              fill={
                lit
                  ? "var(--accent-subtle, var(--surface-2))"
                  : "var(--surface-1)"
              }
              height={22}
              key={index}
              stroke={line}
              width={10}
              x={AXIS + side * offset - 5}
              y={y}
            />
            <path
              d={`M${AXIS + side * offset - 5} ${y + 7}h10m-10 7h10`}
              stroke={signal}
              strokeWidth="0.7"
            />
          </g>
        );
      })}
      <rect
        fill="var(--surface-1)"
        height={28}
        rx={2}
        stroke={line}
        width={20}
        x={AXIS - 10}
        y={AXIS - 14}
      />
      <circle cx={AXIS} cy={AXIS} fill={signal} r={3.5} />
      <line stroke={line} x1={AXIS} x2={AXIS} y1={AXIS - 14} y2={AXIS - 26} />
      <circle cx={AXIS} cy={AXIS - 28} fill="none" r={2} stroke={line} />
    </>
  );
}

/** The Observatory: a telescope tube, an aperture ring, and a dish. */
function Observatory({ lit }: { readonly lit: boolean }) {
  const line = "var(--text-primary)";
  const signal = lit ? "var(--accent-text)" : "var(--text-secondary)";
  return (
    <>
      <path
        d={`M${point(AXIS - 12, 22)}L${point(AXIS + 12, 22)}L${point(AXIS + 12, 86)}L${point(AXIS - 12, 86)}Z`}
        fill="var(--surface-1)"
        stroke={line}
      />
      <ellipse cx={AXIS} cy={22} fill={signal} rx={12} ry={4} stroke={line} />
      <circle cx={AXIS} cy={54} fill="none" r={5} stroke={line} />
      <circle cx={AXIS} cy={54} fill={signal} r={1.6} />
      <path
        d={`M${point(AXIS - 26, 100)}Q${point(AXIS, 82)} ${point(AXIS + 26, 100)}`}
        fill="none"
        stroke={line}
      />
      <line stroke={line} x1={AXIS} x2={AXIS} y1={86} y2={104} />
      <line stroke={line} x1={AXIS - 14} x2={AXIS + 14} y1={104} y2={104} />
    </>
  );
}

const relicVariant = (identityId: number): 1 | 2 | 3 | "observatory" => {
  if (identityId === 4444) return "observatory";
  const variant = identityId - 4440;
  return variant === 1 || variant === 2 || variant === 3 ? variant : 1;
};

export function CraftArt({
  className,
  decorative = false,
  identityId,
  kind = "transient",
  label,
  track = 1,
  lit = true,
}: {
  readonly className?: string | undefined;
  /** Relic preview state only; never changes ownership. */
  readonly lit?: boolean;
  /** Set when the drawing sits beside the identity number it depicts. */
  readonly decorative?: boolean;
  readonly identityId: number;
  readonly kind?: CraftKind;
  /** Overrides the generated accessible name. */
  readonly label?: string | undefined;
  /** Reward track index 1–4, drawn as hull bands. */
  readonly track?: number;
}) {
  const semantics = semanticsFor(
    decorative,
    label ?? `Identity ${identityId}, ${kindLabel[kind]}`,
  );
  const variant = kind === "relic" ? relicVariant(identityId) : undefined;
  return (
    <svg
      {...semantics}
      className={className}
      fill="none"
      strokeLinejoin="round"
      strokeWidth="1.5"
      vectorEffect="non-scaling-stroke"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {variant === undefined ? (
        <OrdinaryCraft
          identityId={identityId}
          lit={kind === "permanent"}
          track={track}
        />
      ) : variant === "observatory" ? (
        <Observatory lit={lit} />
      ) : (
        <Station lit={lit} variant={variant} />
      )}
    </svg>
  );
}
