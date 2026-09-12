"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";
import { Button } from "@/components/ui/button";
import { CraftArt } from "@/components/ui/craft-art";
import { useCollectibleRead } from "@/hooks/use-collectible-read";
import { useCollectionBrowser } from "@/lib/use-collection-browser";
import { parseIdentitySearch } from "@/lib/identity-route";
import { identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type Entry = (typeof collectionManifestArtifact.entries)[number];
const pageSize = 12;
const inputClass =
  "min-h-11 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-[16px] transition-[border-color] duration-[var(--motion-fast)] focus:border-[var(--accent-fill)] focus:outline-none motion-reduce:transition-none";

const galleryState = (read: ReturnType<typeof useCollectibleRead>) => {
  if (read.isError) return "State unavailable";
  if (read.data === undefined) return "Checking state…";
  if (read.data.status !== "discovered") return "Undiscovered";
  return read.data.permanent ? "Orbiter" : "Grounded";
};

function GalleryCard({ entry }: { readonly entry: Entry }) {
  const protocol = useProtocolClient();
  const read = useCollectibleRead(entry.identityId, protocol);
  const permanent = read.data?.status === "discovered" && read.data.permanent;
  const state = galleryState(read);
  return (
    <Link
      href={`/fleet/${entry.identityId}?from=explore`}
      prefetch={false}
      className="group flex min-w-0 flex-col gap-2 rounded-[var(--radius-surface)] border border-line bg-surface-1 p-3 transition-[border-color,background-color] duration-[var(--motion-fast)] hover:border-line-strong hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring motion-reduce:transition-none"
    >
      <div className="aspect-square w-full overflow-hidden rounded-[calc(var(--radius-surface)-4px)] bg-[radial-gradient(ellipse_at_center,var(--surface-3),var(--canvas))]">
        <CraftArt
          className="size-full"
          decorative
          identityId={entry.identityId}
          kind={
            entry.collectibleKind !== 0
              ? "relic"
              : permanent
                ? "permanent"
                : "transient"
          }
          lit={permanent}
          track={entry.track}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 px-1">
        <span className="font-mono text-body font-semibold">
          #{String(entry.identityId).padStart(4, "0")}
        </span>
        <span className="text-caption text-ink-soft">{state}</span>
      </div>
      <span className="px-1 pb-1 text-body-sm text-ink-soft">
        {entry.track === 0
          ? entry.identityId === 4444
            ? identity.terms.indicatorRelic
            : identity.terms.basketRelic
          : `${identity.rewardTrackLabels[entry.track]} · Tier ${identity.rarityTierLabels[entry.tier]}`}
      </span>
    </Link>
  );
}

export function PublicGallery() {
  const router = useRouter();
  const [error, setError] = useState("");
  const { track, tier, page, query, setTrack, setTier, setPage, setQuery } =
    useCollectionBrowser();
  const entries = collectionManifestArtifact.entries.filter(
    (entry) =>
      (track === "all" || String(entry.track) === track) &&
      (tier === "all" || String(entry.tier) === tier),
  );
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const changeFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(0);
  };
  return (
    <section id="explore" aria-label="Collection" className="space-y-6 pb-8">
      <p className="max-w-[65ch] text-body text-ink-soft">
        Discoveries are drawn at random. Browse all 4,444 identities here, then
        buy FUEL to discover your own.
      </p>
      <div className="grid items-start gap-4 tablet:grid-cols-[2fr_1fr_1fr]">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const id = parseIdentitySearch(
              String(new FormData(event.currentTarget).get("identityId") ?? ""),
            );
            if (id === undefined) {
              setError("Enter an identity number from 1 to 4444.");
              return;
            }
            setError("");
            router.push(`/fleet/${id}?from=explore`);
          }}
        >
          <label htmlFor="identity-search" className="text-body-sm">
            Find an identity
          </label>
          <div className="flex gap-2">
            <input
              id="identity-search"
              name="identityId"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={error !== ""}
              aria-describedby={error ? "identity-lookup-feedback" : undefined}
              className={`${inputClass} min-w-0`}
              placeholder="Number, e.g. #0023"
            />
            <Button type="submit" variant="outline">
              Find
            </Button>
          </div>
          {error ? (
            <p
              id="identity-lookup-feedback"
              role="alert"
              className="text-body-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </form>
        <label className="space-y-2 text-body-sm">
          <span className="block">Reward track</span>
          <select
            className={inputClass}
            value={track}
            onChange={(event) => changeFilter(setTrack, event.target.value)}
          >
            <option value="all">All tracks</option>
            {identity.rewardTrackLabels.slice(1).map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
            <option value="0">Relics · all four tracks</option>
          </select>
        </label>
        <label className="space-y-2 text-body-sm">
          <span className="block">Tier</span>
          <select
            className={inputClass}
            value={tier}
            onChange={(event) => changeFilter(setTier, event.target.value)}
          >
            <option value="all">All tiers</option>
            {identity.rarityTierLabels.slice(1).map((label, index) => (
              <option key={label} value={index + 1}>
                Tier {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className="text-body-sm text-ink-soft">
        {entries.length.toLocaleString()} identities
        {entries.length
          ? ` · ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, entries.length)}`
          : " · Try another track or tier."}
      </p>
      <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-4">
        {entries.slice(page * pageSize, (page + 1) * pageSize).map((entry) => (
          <GalleryCard key={entry.identityId} entry={entry} />
        ))}
      </div>
      <nav
        aria-label="Collection pages"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <Button
          variant="outline"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <label className="flex items-center gap-2 text-body-sm">
          Page{" "}
          <select
            aria-label="Collection page"
            className="min-h-11 rounded border border-line bg-canvas px-3"
            value={page}
            onChange={(event) => setPage(Number(event.target.value))}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <option key={index} value={index}>
                {index + 1}
              </option>
            ))}
          </select>{" "}
          of {pageCount}
        </label>
        <Button
          variant="outline"
          disabled={page + 1 >= pageCount}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </nav>
    </section>
  );
}
