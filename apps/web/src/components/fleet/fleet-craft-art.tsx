import { useId } from "react";

const trackTones: Readonly<Record<string, string>> = {
  AAPLc: "#9fc7e9",
  GOOGLc: "#ff7a32",
  METAc: "#cab6e6",
  NVDAc: "#b7d6a4",
};

const fallbackTones = Object.values(trackTones);

/** Keep an unknown label deterministic without inventing collection metadata. */
const toneFor = (rewardTrack: string): string => {
  const knownTone = trackTones[rewardTrack];
  if (knownTone !== undefined) return knownTone;

  const hash = [...rewardTrack].reduce(
    (value, character) => (value * 31 + character.codePointAt(0)!) >>> 0,
    0,
  );
  return fallbackTones[hash % fallbackTones.length] ?? "#ff7a32";
};

/** The approved B · Hangar craft, varied only by real identity and track data. */
export function FleetCraftArt({
  className,
  decorative = false,
  identityId,
  label,
  permanent,
  rewardTrack,
}: {
  readonly className?: string;
  readonly decorative?: boolean;
  readonly identityId: number;
  readonly label?: string;
  readonly permanent: boolean;
  readonly rewardTrack: string;
}) {
  const instanceId = useId().replaceAll(":", "");
  const hullGradientId = `fleet-hull-${instanceId}`;
  const plumeGradientId = `fleet-plume-${instanceId}`;
  const tone = toneFor(rewardTrack);
  const wings = 30 + (identityId % 4) * 7;
  const nose = 67 + (identityId % 3) * 7;
  const ports = 2 + (identityId % 3);
  const accessibleName =
    label ?? `${permanent ? "Orbiter" : "Grounded craft"} #${identityId}`;

  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : accessibleName}
      className={[className, "craft-svg", permanent ? "orbiter" : undefined]
        .filter(Boolean)
        .join(" ")}
      focusable="false"
      height="100%"
      role={decorative ? undefined : "img"}
      viewBox="0 0 400 400"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={hullGradientId} x1="0" x2="1">
          <stop stopColor="#555e67" />
          <stop offset=".46" stopColor="#252b31" />
          <stop offset=".7" stopColor="#444d55" />
          <stop offset="1" stopColor="#191d22" />
        </linearGradient>
        <linearGradient id={plumeGradientId} x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#fff2d0" />
          <stop offset=".26" stopColor={tone} />
          <stop offset="1" stopColor="#ff3c00" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="craft-core">
        <path
          className="plume"
          d="M180 303 Q200 382 220 303Z"
          fill={`url(#${plumeGradientId})`}
          opacity={permanent ? 1 : 0}
        />
        <path
          d={`M${200 - wings} 242 L${105 - wings} 303 L165 292 L200 320 L235 292 L${295 + wings} 303 L${200 + wings} 242Z`}
          fill="#252b31"
          stroke="#7e8790"
          strokeWidth="3"
        />
        <path
          d={`M200 ${nose} Q${244 + (identityId % 10)} 135 ${236 + (identityId % 8)} 262 L218 312 L182 312 L${164 - (identityId % 8)} 262 Q${156 - (identityId % 10)} 135 200 ${nose}Z`}
          fill={`url(#${hullGradientId})`}
          stroke="#bdc2c5"
          strokeWidth="3"
        />
        <path
          d={`M200 ${nose + 8}V307 M171 245H229 M169 263H231`}
          opacity=".8"
          stroke="#707982"
          strokeWidth="2"
        />
        <path
          d="M177 118 Q200 98 223 118 L218 151 Q200 160 182 151Z"
          fill="#0f171c"
          stroke={tone}
          strokeWidth="3"
        />
        <path
          d="M165 278 L184 268 L181 310 H160Z M235 278 L216 268 L219 310 H240Z"
          fill="#13171b"
          stroke="#a1a8ae"
          strokeWidth="3"
        />
        {Array.from({ length: ports }, (_unused, index) => (
          <circle
            cx="200"
            cy={155 + index * 25}
            fill={permanent ? tone : "#16191d"}
            key={index}
            r="5"
            stroke="#c7ccd0"
            strokeWidth="3"
          />
        ))}
        <path d="M166 223H234" stroke={tone} strokeWidth="5" />
        <text
          fill="#d8d8d3"
          fontFamily="monospace"
          fontSize="12"
          textAnchor="middle"
          x="200"
          y="205"
        >
          O/{String(identityId).padStart(4, "0")}
        </text>
      </g>
    </svg>
  );
}
