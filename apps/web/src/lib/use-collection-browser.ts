"use client";
import { useEffect, useState } from "react";
const storageKey = "orbit:collection-browser:v1";
const empty = { track: "all", tier: "all", page: 0, query: "" };
const validSaved = (
  saved: Partial<typeof empty> | null,
): saved is typeof empty => {
  if (saved === null) return false;
  return [
    ["all", "0", "1", "2", "3", "4"].includes(saved.track ?? ""),
    ["all", "0", "1", "2", "3", "4"].includes(saved.tier ?? ""),
    Number.isInteger(saved.page),
    (saved.page ?? -1) >= 0,
    (saved.page ?? 371) < 371,
    typeof saved.query === "string",
  ].every(Boolean);
};
/** Keep browsing context when returning from an identity; never cache ownership. */
export function useCollectionBrowser() {
  const [state, setState] = useState(empty);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let restored = empty;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (validSaved(saved))
        restored = {
          track: saved.track,
          tier: saved.tier,
          page: saved.page,
          query: saved.query.slice(0, 40),
        };
    } catch {
      /* Browsing works without storage. */
    }
    const query = new URLSearchParams(window.location.search).get("q");
    // Read browser navigation context after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      ...restored,
      ...(query === null ? {} : { query: query.slice(0, 40) }),
    });
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(state));
      } catch {
        /* Optional convenience. */
      }
  }, [ready, state]);
  return {
    ...state,
    setTrack: (track: string) => setState((s) => ({ ...s, track, page: 0 })),
    setTier: (tier: string) => setState((s) => ({ ...s, tier, page: 0 })),
    setPage: (page: number) => setState((s) => ({ ...s, page })),
    setQuery: (query: string) => setState((s) => ({ ...s, query })),
  };
}
