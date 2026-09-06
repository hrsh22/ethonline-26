"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { identity } from "@/lib/identity";

export function CraftSharing({ identityId }: { readonly identityId: number }) {
  const [feedback, setFeedback] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const url = () =>
    new URL(`/fleet/${identityId}`, window.location.origin).href;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setFeedback("Public craft link copied.");
      setManualUrl("");
    } catch {
      setManualUrl(url());
      setFeedback("Copy this public link from the field below.");
    }
  };
  return (
    <section
      aria-label="Share and wallet display"
      className="mx-auto w-full max-w-[1600px] space-y-3 px-4 pb-6 tablet:px-8"
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          Copy craft link
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            if (!navigator.share) {
              await copy();
              return;
            }
            setBusy(true);
            try {
              await navigator.share({
                title: `${identity.brand} #${identityId}`,
                url: url(),
              });
              setFeedback("Sharing complete.");
            } catch (error) {
              setFeedback(
                error instanceof Error && error.name === "AbortError"
                  ? "Sharing cancelled. You can still copy the link."
                  : "Sharing unavailable. Use Copy craft link.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Share craft
        </Button>
      </div>
      <p role="status" className="text-body-sm text-ink-soft">
        {feedback}
      </p>
      {manualUrl ? (
        <label className="block text-body-sm">
          Public craft link
          <input
            readOnly
            value={manualUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 min-h-11 w-full border border-line bg-canvas px-3"
          />
        </label>
      ) : null}
      <details className="rounded border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-body-sm">
          Missing from your wallet’s NFT display?
        </summary>
        <p className="mt-2 text-body-sm text-ink-soft">
          Wallet galleries can update later than the chain. Check the verified
          owner above and the onchain record. Artwork here is a web
          illustration; this deployment’s sealed metadata uses placeholder
          images.
        </p>
        <dl className="mt-3 space-y-2 break-all text-body-sm">
          <div>
            <dt>Network</dt>
            <dd>{deploymentEnvironment.chainLabel}</dd>
          </div>
          <div>
            <dt>Collection contract</dt>
            <dd>
              {protocolDeploymentManifest?.contracts.fuelMirror ??
                "Deployment unavailable"}
            </dd>
          </div>
          <div>
            <dt>Identity ID</dt>
            <dd>{identityId}</dd>
          </div>
        </dl>
        <p className="mt-3 text-body-sm text-ink-soft">
          If your wallet offers Import NFT, use these details on the matching
          network. Importing changes its display only. It does not transfer or
          Launch your collectible.
        </p>
      </details>
    </section>
  );
}
