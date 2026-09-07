"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";
import { Button } from "@/components/ui/button";
import { CraftArt } from "@/components/ui/craft-art";
import { parseCanonicalIdentityId } from "@/lib/identity-route";
import { identity } from "@/lib/identity";

const samples = [23, 208, 710, 1204, 1639, 3021, 4441, 4444];

const subscribeHydration = () => () => undefined;
const hydrated = () => true;
const serverHydrated = () => false;

export function PublicGallery() {
  const ready = useSyncExternalStore(
    subscribeHydration,
    hydrated,
    serverHydrated,
  );
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <section
      id="explore"
      aria-labelledby="gallery-heading"
      className="my-6 scroll-mt-28 space-y-4 border-y border-line py-6"
    >
      <h2 id="gallery-heading" className="font-mono text-title font-semibold">
        Explore the collection
      </h2>
      <p className="max-w-[70ch] text-body text-ink-soft">
        A Discovery Draw selects your identity at random. Launch keeps that
        identity and makes it permanent. These web previews illustrate the
        collection; open an identity to check its current state.
      </p>
      <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
        {samples.map((id) => {
          const entry = collectionManifestArtifact.entries[id - 1];
          const track = entry?.track ?? 1;
          return (
            <Link
              key={id}
              href={`/fleet/${id}`}
              prefetch={false}
              className="flex min-w-0 flex-col items-center gap-2 rounded-[var(--radius-surface)] border border-line bg-surface-1 p-3 hover:border-[var(--accent-border)] focus-visible:ring-3 focus-visible:ring-ring"
            >
              <div className="aspect-square w-32 max-w-full [content-visibility:auto]">
                <CraftArt
                  className="size-full"
                  decorative
                  identityId={id}
                  kind={id > 4440 ? "relic" : "transient"}
                  track={track}
                />
              </div>
              <span className="max-w-full font-mono [overflow-wrap:anywhere]">
                Identity #{id}
              </span>
              <span className="text-caption text-ink-soft">
                Illustrative preview
              </span>
            </Link>
          );
        })}
      </div>
      <p className="text-body-sm text-ink-soft">
        Ordinary craft belong to one of four Reward Tracks:{" "}
        {identity.rewardTrackLabels.slice(1).join(", ")}. Track bands describe
        the assigned token, not a promised payout. All assets here are valueless
        test assets.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("identityId");
          const id = parseCanonicalIdentityId(String(value ?? "").trim());
          if (id === undefined) {
            setError(
              "Enter a whole identity number from 1 to 4444, without leading zeros.",
            );
            return;
          }
          setError("");
          router.push(`/fleet/${id}`);
        }}
      >
        <label className="flex flex-col gap-2 text-body-sm">
          Find an identity
          <input
            disabled={!ready}
            name="identityId"
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={error !== ""}
            aria-describedby="identity-lookup-feedback"
            className="h-11 max-w-full rounded border border-line bg-canvas px-3 text-[16px]"
            placeholder="1–4444"
          />
        </label>
        <Button disabled={!ready} type="submit" variant="outline">
          Open identity
        </Button>
        <p
          id="identity-lookup-feedback"
          role="status"
          className="w-full text-body-sm text-ink-soft"
        >
          {error}
        </p>
      </form>
    </section>
  );
}
