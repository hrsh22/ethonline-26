"use client";

import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  const timer = setInterval(notify, 30_000);
  return () => clearInterval(timer);
};
const currentTime = () => Math.floor(Date.now() / 30_000) * 30_000;

export function RelativeTime({
  timestamp,
  countdown = false,
}: {
  readonly timestamp: number;
  readonly countdown?: boolean;
}) {
  const now = useSyncExternalStore(subscribe, currentTime, () => 0);
  const delta = timestamp - now;
  const minutes = Math.ceil(Math.abs(delta) / 60_000);
  const duration =
    minutes < 60
      ? `${minutes} min`
      : minutes < 1440
        ? `${Math.ceil(minutes / 60)} hr`
        : `${Math.ceil(minutes / 1440)} days`;
  const exact = new Date(timestamp).toISOString();
  const label =
    now === 0
      ? exact
      : countdown && delta <= 0
        ? "Now"
        : Math.abs(delta) < 60_000
          ? countdown
            ? "In less than a minute"
            : "Just now"
          : delta > 0
            ? `In ${duration}`
            : `${duration} ago`;
  return (
    <time dateTime={exact} title={exact}>
      {label}
    </time>
  );
}
