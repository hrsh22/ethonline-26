import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { collectibleExplorerUrls } from "@/lib/collectible-explorer";
import { applicationCopy } from "@/lib/identity";

const collectionContract = protocolDeploymentManifest?.contracts.fuelMirror;

/**
 * Links to the onchain record.
 *
 * The audited version rendered as a bordered band across the page with a mono
 * label and a pill button floating inside it, which read as a control group
 * rather than as provenance. It is a quiet footnote now: the label states what
 * the links are, and the links look like links.
 */
export function CollectibleExplorerLinks({
  identityId,
}: {
  readonly identityId?: number;
}) {
  if (collectionContract === undefined) return null;
  const urls = collectibleExplorerUrls({
    chainId: deploymentEnvironment.chainId,
    contract: collectionContract,
    identityId,
  });
  if (urls === undefined) return null;

  const linkClassName =
    "flex min-h-11 items-center text-body-sm font-medium text-[var(--accent-text)] underline decoration-1 underline-offset-4 hover:decoration-2";

  return (
    <nav
      aria-label={applicationCopy.craft.onchainRecord}
      className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line pt-4"
    >
      <span className="font-mono text-label tracking-[0.12em] text-ink-faint uppercase">
        {applicationCopy.craft.onchainRecord}
      </span>
      {urls.identity === undefined ? null : (
        <a
          className={linkClassName}
          data-collectible-explorer="identity"
          href={urls.identity}
          rel="noreferrer"
          target="_blank"
        >
          {applicationCopy.craft.viewOnchainIdentity}
        </a>
      )}
      <a
        className={linkClassName}
        data-collectible-explorer="collection"
        href={urls.collection}
        rel="noreferrer"
        target="_blank"
      >
        {applicationCopy.craft.viewOnchainCollection}
      </a>
    </nav>
  );
}
