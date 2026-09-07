"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { collectionManifestArtifact } from "@orbit/config/collection-manifest";
import { useState } from "react";
import { getAddress, isAddress } from "viem";

import { CollectorHelp } from "@/components/collector-help";
import { ClaimReview } from "@/components/rewards/rewards-panel";
import { CollectibleExplorerLinks } from "@/components/fleet/collectible-explorer-links";
import { trackIndexFor } from "@/components/fleet/fleet-craft-card";
import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonVariants } from "@/components/ui/button";
import { CraftArt } from "@/components/ui/craft-art";
import { DataList, DataRow } from "@/components/ui/data-list";
import {
  dialogActionsClassName,
  dialogBackdropClassName,
  dialogDescriptionClassName,
  dialogPopupClassName,
  dialogTitleClassName,
} from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { Panel, Well } from "@/components/ui/panel";
import { Address, Amount } from "@/components/ui/value";
import { useCollectibleRead } from "@/hooks/use-collectible-read";
import { formatTokenAmount } from "@/lib/format";
import { applicationCopy, identity } from "@/lib/identity";
import { isTransactionInFlight } from "@/lib/transaction-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type WalletRead = ProtocolClient["walletRead"];
type WalletSnapshot = Extract<
  WalletRead,
  { readonly status: "loaded" }
>["snapshot"];
type Craft = WalletSnapshot["collectibles"]["transient"][number];
type DirectCollectible = Awaited<
  ReturnType<NonNullable<ProtocolClient["reader"]>["readCollectible"]>
>;

/**
 * The reader reports an identity that has never been drawn as its own result.
 * Most of the 4,444 identity pages are that state, and reading it as a failed
 * read left them offering a retry that could never succeed.
 */
const notDiscovered = (direct: DirectCollectible | undefined): boolean =>
  direct?.status === "not-discovered";

/** The owner of an identity this session read directly, if it has one. */
const directOwner = (direct: DirectCollectible | undefined) =>
  direct?.status === "discovered" ? direct.owner : undefined;

const loadedWallet = (walletRead: WalletRead): WalletSnapshot | undefined =>
  walletRead.status === "loaded" ? walletRead.snapshot : undefined;

const heldCraft = (
  wallet: WalletSnapshot | undefined,
  kind: "permanent" | "transient",
  identityId: number,
): Craft | undefined =>
  wallet?.collectibles[kind].find((item) => item.identityId === identityId);

const craftDetailState = (
  wallet: WalletSnapshot | undefined,
  direct: DirectCollectible | undefined,
  address: string | undefined,
  identityId: number,
) => {
  // An identity that was never drawn is held by nobody, whatever a stale
  // wallet snapshot still lists for it.
  if (direct?.status === "not-discovered") {
    return {
      craft: undefined,
      currentOwner: false,
      permanent: undefined,
      transient: undefined,
    } as const;
  }
  const walletTransient = heldCraft(wallet, "transient", identityId);
  const walletPermanent = heldCraft(wallet, "permanent", identityId);
  if (direct === undefined) {
    return {
      craft: walletTransient ?? walletPermanent,
      currentOwner:
        walletTransient !== undefined || walletPermanent !== undefined,
      permanent: walletPermanent,
      transient: walletTransient,
    } as const;
  }
  const currentOwner =
    address !== undefined &&
    direct.owner.toLowerCase() === address.toLowerCase();
  return {
    craft: direct.collectible,
    currentOwner,
    permanent: direct.permanent ? direct.collectible : undefined,
    transient: direct.permanent ? undefined : direct.collectible,
  } as const;
};

const ownerActionDisclosure = (permanent: boolean): string =>
  permanent
    ? applicationCopy.craft.permanentOwnerOnly
    : applicationCopy.craft.transientOwnerOnly;

const transferRecipientReason = (
  candidate: string,
  validAddress: boolean,
  owner: string | undefined,
): string | undefined => {
  if (candidate === "") return applicationCopy.craft.transferRecipientRequired;
  if (!validAddress || /^0x0{40}$/iu.test(candidate)) {
    return applicationCopy.craft.transferRecipientInvalid;
  }
  if (owner !== undefined && candidate.toLowerCase() === owner.toLowerCase()) {
    return applicationCopy.craft.transferRecipientSame;
  }
  return undefined;
};

const missingCraftFeedback = (
  walletRead: WalletRead,
  directRead: { readonly isError: boolean; readonly isPending: boolean },
  undiscovered: boolean,
) => {
  if (undiscovered) {
    return {
      description: applicationCopy.craft.notDiscovered,
      title: applicationCopy.craft.notDiscoveredTitle,
      tone: "empty",
    } as const;
  }
  if (directRead.isPending) {
    return {
      description: applicationCopy.fleet.loading,
      title: "Loading identity details",
      tone: "loading",
    } as const;
  }
  if (directRead.isError) {
    return {
      description: applicationCopy.craft.directReadFailed,
      title: "Identity unavailable",
      tone: "error",
    } as const;
  }
  switch (walletRead.status) {
    case "loading":
      return {
        description: applicationCopy.fleet.loading,
        title: "Loading identity details",
        tone: "loading",
      } as const;
    case "failed":
      return {
        description: applicationCopy.fleet.readFailed,
        title: "Identity unavailable",
        tone: "error",
      } as const;
    case "blocked":
      return {
        description: applicationCopy.fleet.connect,
        title: "Connect a wallet",
        tone: "blocked",
      } as const;
    case "loaded":
      return walletRead.snapshot.collectibles.permanentHoldingsStatus ===
        "complete"
        ? ({
            description: applicationCopy.craft.notHeld,
            title: "Identity not held",
            tone: "empty",
          } as const)
        : ({
            description: applicationCopy.craft.holdingsUnavailable,
            title: "Identity classification is incomplete",
            tone: "partial",
          } as const);
  }
};

const transactionControlDisabledReason = (
  protocol: ProtocolClient,
  directStateObserved: boolean,
): string | undefined => {
  if (protocol.accessState !== "ready") {
    return "Connect the wallet on the supported network before using this action.";
  }
  if (isTransactionInFlight(protocol.transaction)) {
    return "Wait for the current transaction to finish before using this action.";
  }
  if (
    !directStateObserved &&
    (protocol.walletRead.status === "failed" ||
      (protocol.walletRead.status === "loaded" && protocol.walletRead.stale))
  )
    return "Checking current ownership before another action.";
  if (protocol.walletSynchronizing && !directStateObserved) {
    return applicationCopy.transaction.synchronizing;
  }
  return undefined;
};

/**
 * The commitment burns exactly one whole token. The review used to open for
 * any wallet, and one holding less than that learned it could not afford the
 * burn only from the wallet prompt or the reverted transaction.
 */
const launchDisabledReason = (
  controlsDisabledReason: string | undefined,
  wallet: WalletSnapshot | undefined,
): string | undefined => {
  if (controlsDisabledReason !== undefined) return controlsDisabledReason;
  if (wallet !== undefined && wallet.liquidToken.rawWei < 10n ** 18n) {
    return applicationCopy.launch.insufficientFuel(
      formatTokenAmount(wallet.liquidToken.rawWei).display,
    );
  }
  return undefined;
};

function BackToCollection() {
  return (
    <ButtonLink href="/fleet" size="sm" variant="ghost">
      {applicationCopy.craft.back}
    </ButtonLink>
  );
}

/**
 * What the collection already says about an identity, whether or not this
 * session could read it.
 *
 * The manifest is published, deterministic and part of the app; a failed
 * onchain read or an undiscovered identity does not make its track, tier or
 * weight unknown. Only its ownership and its onchain state are unknown.
 */
const manifestFactsFor = (identityId: number) => {
  const entry = collectionManifestArtifact.entries.find(
    (candidate) => candidate.identityId === identityId,
  );
  if (entry === undefined) return undefined;
  return {
    kind: entry.collectibleKind,
    rarityTier: identity.rarityTierLabels[entry.tier],
    rewardTrack: identity.rewardTrackLabels[entry.track],
    track: entry.track === 0 ? undefined : entry.track,
    weight: entry.weight === 0 ? undefined : entry.weight / 100,
  } as const;
};

type ManifestFacts = NonNullable<ReturnType<typeof manifestFactsFor>>;

const specialKindLabel = (kind: ManifestFacts["kind"]): string | undefined => {
  if (kind === 1) return identity.terms.basketRelic;
  if (kind === 2) return identity.terms.indicatorRelic;
  return undefined;
};

/**
 * The identity's face while nothing about it has been observed. Dimmed,
 * because the drawing is what the collection defines rather than what this
 * wallet holds.
 */
function ManifestPortrait({
  facts,
  identityId,
}: {
  readonly facts: ManifestFacts;
  readonly identityId: number;
}) {
  return (
    <Panel
      meta={<Badge>{applicationCopy.craft.manifestUnobserved}</Badge>}
      title={applicationCopy.craft.identityPanel}
    >
      <figure className="flex flex-col items-center gap-3 rounded-[var(--radius-control)] border border-line bg-canvas p-4">
        <CraftArt
          className="h-auto w-full max-w-[16rem] opacity-60"
          decorative
          identityId={identityId}
          kind={facts.kind === 0 ? "transient" : "relic"}
          track={facts.track ?? 1}
        />
        <figcaption className="font-mono text-caption text-ink-soft tabular-nums">
          #{String(identityId).padStart(4, "0")} · {facts.rewardTrack}
        </figcaption>
      </figure>
    </Panel>
  );
}

/** Track, tier and weight as the published manifest assigns them. */
function ManifestFactsPanel({ facts }: { readonly facts: ManifestFacts }) {
  const special = specialKindLabel(facts.kind);
  return (
    <Panel title={applicationCopy.craft.manifestPanel}>
      <DataList>
        <DataRow
          label={applicationCopy.craft.track}
          value={facts.rewardTrack}
        />
        <DataRow label={applicationCopy.craft.tier} value={facts.rarityTier} />
        {facts.weight === undefined ? null : (
          <DataRow
            label={applicationCopy.craft.weight}
            value={<span>{facts.weight}&times;</span>}
          />
        )}
        {special === undefined ? null : (
          <DataRow
            label={applicationCopy.craft.manifestSpecial}
            value={special}
          />
        )}
      </DataList>
      <p className="mt-3 text-caption text-ink-soft">
        {applicationCopy.craft.manifestNote}
      </p>
    </Panel>
  );
}

function MissingCraft({
  directRead,
  identityId,
  onRetry,
  undiscovered,
  walletRead,
}: {
  readonly directRead: {
    readonly isError: boolean;
    readonly isPending: boolean;
  };
  readonly identityId: number;
  readonly onRetry: () => void;
  readonly undiscovered: boolean;
  readonly walletRead: WalletRead;
}) {
  const facts = manifestFactsFor(identityId);
  return (
    <PageFrame>
      <PageHeading
        actions={<BackToCollection />}
        eyebrow={applicationCopy.craft.eyebrow}
        title={applicationCopy.craft.title(identityId)}
      />
      <div className="mt-4 grid gap-3 laptop:grid-cols-12 laptop:items-start">
        <div className="grid gap-3 laptop:col-span-5">
          {facts === undefined ? null : (
            <ManifestPortrait facts={facts} identityId={identityId} />
          )}
          <CollectibleExplorerLinks identityId={identityId} />
          <CollectorHelp topic="wallet-artwork" />
        </div>
        <div className="grid gap-3 laptop:col-span-7">
          <StateFeedback
            {...missingCraftFeedback(walletRead, directRead, undiscovered)}
            action={
              !undiscovered &&
              (walletRead.status === "failed" || directRead.isError) ? (
                <Button
                  onClick={onRetry}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {applicationCopy.access.retryWalletRead}
                </Button>
              ) : undefined
            }
          />
          {facts === undefined ? (
            <p className="text-body-sm text-ink-soft">
              {applicationCopy.craft.manifestOutOfRange}
            </p>
          ) : (
            <ManifestFactsPanel facts={facts} />
          )}
        </div>
      </div>
    </PageFrame>
  );
}

/**
 * The irreversible Launch: a review control, then an alert dialog whose
 * confirming action stays disabled until the reader has ticked the box.
 */
function LaunchDialog({
  confirmed,
  disabledReason,
  fuelBalance,
  identityId,
  onConfirmedChange,
  protocol,
}: {
  readonly confirmed: boolean;
  readonly disabledReason: string | undefined;
  readonly fuelBalance: string | undefined;
  readonly identityId: number;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly protocol: ProtocolClient;
}) {
  const actionDisabled = !confirmed || disabledReason !== undefined;
  return (
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className={dialogBackdropClassName} />
      <AlertDialog.Popup className={dialogPopupClassName}>
        <p className="font-mono text-label font-semibold tracking-[0.14em] text-[var(--status-warning-text)] uppercase">
          {applicationCopy.launch.dialogLabel}
        </p>
        <AlertDialog.Title className={dialogTitleClassName}>
          {applicationCopy.launch.title}
        </AlertDialog.Title>
        <AlertDialog.Description className={dialogDescriptionClassName}>
          {applicationCopy.launch.introduction}
        </AlertDialog.Description>
        <DataList className="mt-4">
          <DataRow
            label="Collectible"
            value={`Grounded Craft #${identityId}`}
          />
          <DataRow label="Network" value="Base Sepolia · chain 84532" />
          <DataRow
            label="After Launch"
            value={`Permanent Orbiter #${identityId}`}
          />
          <DataRow
            label="Cost"
            value="Burns exactly 1 $FUEL forever, plus network gas"
          />
        </DataList>
        <Well className="mt-4 border-[var(--status-warning-text)]">
          <p className="text-body-sm font-semibold text-ink" role="note">
            {applicationCopy.launch.warning}
          </p>
          {fuelBalance === undefined ? null : (
            <p className="mt-1 font-mono text-body-sm text-ink-soft">
              {applicationCopy.launch.fuelBalance(fuelBalance)}
            </p>
          )}
          <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-body-sm text-ink">
            <input
              checked={confirmed}
              className="mt-0.5 size-5 shrink-0 accent-[var(--accent-fill)]"
              onChange={(event) => onConfirmedChange(event.target.checked)}
              type="checkbox"
            />
            <span>{applicationCopy.launch.confirmationLabel}</span>
          </label>
        </Well>
        <div className={dialogActionsClassName}>
          <AlertDialog.Close className={buttonVariants({ variant: "outline" })}>
            {applicationCopy.launch.cancelAction}
          </AlertDialog.Close>
          <AlertDialog.Close
            aria-describedby={
              actionDisabled ? "launch-confirmation-disabled-reason" : undefined
            }
            className={buttonVariants({ variant: "destructive" })}
            disabled={actionDisabled}
            onClick={() =>
              protocol.execute(
                { type: "commit-collectible", identityId },
                `${applicationCopy.launch.title} #${identityId}`,
              )
            }
          >
            {applicationCopy.launch.finalAction}
          </AlertDialog.Close>
        </div>
        {actionDisabled ? (
          <DisabledReason id="launch-confirmation-disabled-reason">
            {confirmed
              ? disabledReason
              : "Confirm that you understand the irreversible launch before continuing."}
          </DisabledReason>
        ) : null}
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  );
}

function LaunchControl({
  disabledReason,
  fuelBalance,
  identityId,
  protocol,
}: {
  readonly disabledReason: string | undefined;
  readonly fuelBalance: string | undefined;
  readonly identityId: number;
  readonly protocol: ProtocolClient;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const controlsDisabled = disabledReason !== undefined;
  return (
    <div className="grid gap-2">
      <p className="text-body-sm text-ink-soft">
        {applicationCopy.launch.introduction}
      </p>
      <AlertDialog.Root onOpenChange={(open) => !open && setConfirmed(false)}>
        <div>
          <AlertDialog.Trigger
            aria-describedby={
              controlsDisabled ? "launch-review-disabled-reason" : undefined
            }
            className={buttonVariants()}
            disabled={controlsDisabled}
          >
            {applicationCopy.launch.reviewAction}
          </AlertDialog.Trigger>
        </div>
        {disabledReason === undefined ? null : (
          <DisabledReason id="launch-review-disabled-reason">
            {disabledReason}
          </DisabledReason>
        )}
        <LaunchDialog
          confirmed={confirmed}
          disabledReason={disabledReason}
          fuelBalance={fuelBalance}
          identityId={identityId}
          onConfirmedChange={setConfirmed}
          protocol={protocol}
        />
      </AlertDialog.Root>
    </div>
  );
}

/**
 * The Commitment control, or the confirmation that one is settling.
 *
 * A confirmed Commitment takes a moment to reach the wallet read, and offering
 * the control again in that window invites a second irreversible submission
 * for a collectible that is already permanent.
 */
function LaunchSlot({
  controlsDisabledReason,
  identityId,
  protocol,
  transientHeld,
  wallet,
}: {
  readonly controlsDisabledReason: string | undefined;
  readonly identityId: number;
  readonly protocol: ProtocolClient;
  readonly transientHeld: boolean;
  readonly wallet: WalletSnapshot | undefined;
}) {
  if (!transientHeld) return null;
  if (protocol.walletSynchronizing) {
    return (
      <StateFeedback
        compact
        description={applicationCopy.craft.launchSynchronizing}
        title={applicationCopy.craft.launchConfirmed}
        tone="loading"
      />
    );
  }
  return (
    <LaunchControl
      key={`${protocol.address}:${protocol.chainId}:${identityId}:${wallet?.liquidToken.rawWei}`}
      disabledReason={launchDisabledReason(controlsDisabledReason, wallet)}
      fuelBalance={
        wallet === undefined
          ? undefined
          : formatTokenAmount(wallet.liquidToken.rawWei).display
      }
      identityId={identityId}
      protocol={protocol}
    />
  );
}

function TransferControl({
  permanent,
  disabledReason,
  identityId,
  owner,
  protocol,
  visible,
}: {
  readonly disabledReason: string | undefined;
  readonly identityId: number;
  readonly owner: string | undefined;
  readonly protocol: ProtocolClient;
  readonly visible: boolean;
  readonly permanent: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [reviewedScope, setReviewedScope] = useState<string | null>(null);
  if (!visible) return null;
  const candidate = recipient.trim();
  const validAddress = isAddress(candidate);
  const recipientReason = transferRecipientReason(
    candidate,
    validAddress,
    owner,
  );
  const actionDisabledReason = disabledReason ?? recipientReason;
  const scope = `${protocol.address}:${protocol.chainId}:${identityId}:${permanent}:${candidate}`;
  const reviewChanged = reviewedScope !== scope;
  return (
    <Well className="grid gap-2">
      <h3
        className="font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase"
        id="craft-transfer-title"
      >
        {applicationCopy.craft.transferTitle}
      </h3>
      <p className="text-body-sm text-ink-soft">
        {applicationCopy.craft.transferIntroduction}
      </p>
      <label
        className="mt-1 font-mono text-label tracking-[0.1em] text-ink-faint uppercase"
        htmlFor="craft-transfer-recipient"
      >
        {applicationCopy.craft.transferRecipient}
      </label>
      <input
        aria-describedby="craft-transfer-disclosure"
        aria-invalid={candidate !== "" && recipientReason !== undefined}
        autoCapitalize="none"
        autoComplete="off"
        className="min-h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-1 px-3 font-mono text-body-sm text-ink placeholder:text-ink-faint aria-invalid:border-[var(--status-danger-text)]"
        id="craft-transfer-recipient"
        onChange={(event) => setRecipient(event.target.value)}
        placeholder="0x…"
        spellCheck={false}
        type="text"
        value={recipient}
      />
      <p className="text-caption text-ink-faint" id="craft-transfer-disclosure">
        {applicationCopy.craft.transferDisclosure}
      </p>
      <div>
        <Button
          aria-describedby={
            actionDisabledReason === undefined
              ? undefined
              : "craft-transfer-disabled-reason"
          }
          disabled={actionDisabledReason !== undefined}
          onClick={() => setReviewedScope(scope)}
          type="button"
          variant="outline"
        >
          Review transfer
        </Button>
      </div>
      <AlertDialog.Root
        open={reviewedScope !== null}
        onOpenChange={(open) => !open && setReviewedScope(null)}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={dialogBackdropClassName} />
          <AlertDialog.Popup className={dialogPopupClassName}>
            <AlertDialog.Title className={dialogTitleClassName}>
              Review transfer
            </AlertDialog.Title>
            <AlertDialog.Description className={dialogDescriptionClassName}>
              Check the full recipient. Confirming opens your wallet for this
              transfer.
            </AlertDialog.Description>
            <DataList className="mt-4">
              <DataRow
                label="Collectible"
                value={`${permanent ? "Orbiter" : "Grounded Craft"} #${identityId}`}
              />
              <DataRow
                label="Recipient"
                value={<span className="break-all font-mono">{candidate}</span>}
              />
              <DataRow label="Network" value="Base Sepolia · chain 84532" />
            </DataList>
            <p className="mt-4 text-body">
              {permanent
                ? "The Orbiter and its attached Pending Rewards move to the recipient. No backing $FUEL moves with a permanent Orbiter."
                : "This Grounded Craft and its backing 1 $FUEL move to the recipient. Your $FUEL balance decreases by 1. This transfer does not Launch the craft."}
            </p>
            {reviewChanged ? (
              <p role="alert" className="mt-3 text-body">
                The wallet or transfer details changed. Go back and review them
                again.
              </p>
            ) : null}
            <div className={dialogActionsClassName}>
              <AlertDialog.Close
                className={buttonVariants({ variant: "outline" })}
              >
                Back
              </AlertDialog.Close>
              <AlertDialog.Close
                className={buttonVariants()}
                disabled={reviewChanged || actionDisabledReason !== undefined}
                onClick={() => {
                  if (
                    reviewChanged ||
                    !validAddress ||
                    actionDisabledReason !== undefined
                  )
                    return;
                  void protocol.execute(
                    {
                      type: "direct-collectible-transfer",
                      identityId,
                      recipient: getAddress(candidate),
                    },
                    `${applicationCopy.craft.transferAction} #${identityId}`,
                  );
                }}
              >
                Confirm transfer
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {actionDisabledReason === undefined ? null : (
        <DisabledReason id="craft-transfer-disabled-reason">
          {actionDisabledReason}
        </DisabledReason>
      )}
    </Well>
  );
}

function ClaimControl({
  craft,
  disabledReason,
  identityId,
  protocol,
  rewards,
}: {
  readonly craft: Craft | undefined;
  readonly disabledReason: string | undefined;
  readonly identityId: number;
  readonly protocol: ProtocolClient;
  readonly rewards: Craft["pendingRewards"];
}) {
  if (craft?.claimEligible !== true || rewards.length === 0) return null;
  return (
    <ClaimReview
      batch={[identityId]}
      rewarded={[craft]}
      disabledReason={
        craft.pendingRewardsStatus === "unavailable" ||
        craft.claimEligibilityStatus === "unavailable"
          ? "Reward details are updating. Wait for a current read before claiming."
          : disabledReason
      }
      onConfirm={() =>
        void protocol.execute(
          { type: "claim", identityIds: [identityId] },
          applicationCopy.rewards.claim,
        )
      }
    />
  );
}

/**
 * A legitimate zero and unreadable evidence are different facts. The reader
 * substitutes zero when a per-identity read fails, so this distinguishes them
 * from the snapshot's status rather than from the amount.
 */
function CraftRewards({
  rewards,
  unavailable,
}: {
  readonly rewards: Craft["pendingRewards"];
  readonly unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <StateFeedback
        compact
        description={applicationCopy.craft.rewardsUnavailable}
        title={applicationCopy.common.readFailed}
        tone="partial"
      />
    );
  }
  if (rewards.length === 0) {
    return (
      <p className="text-body-sm text-ink-soft">
        {applicationCopy.craft.noRewardsAccrued}
      </p>
    );
  }
  return (
    <>
      <DataList>
        {rewards.map((reward) => (
          <DataRow
            key={reward.track}
            label={reward.track}
            tone="live"
            value={<Amount unit={reward.track} value={reward.rawTokenUnits} />}
          />
        ))}
      </DataList>
      {/* The exact integer is evidence for a claim, not the displayed value. */}
      <Disclosure
        className="mt-2"
        searchable
        title={applicationCopy.craft.rawUnitsDisclosure}
      >
        <DataList>
          {rewards.map((reward) => (
            <DataRow
              key={reward.track}
              label={reward.track}
              value={
                <code className="font-mono text-caption [overflow-wrap:anywhere]">
                  {reward.rawTokenUnits.toString()}
                </code>
              }
            />
          ))}
        </DataList>
      </Disclosure>
    </>
  );
}

const ownerValue = (
  owner: string | undefined,
  currentOwner: boolean,
): React.ReactNode => {
  if (owner !== undefined) return <Address value={owner} />;
  return currentOwner ? applicationCopy.craft.heldByWallet : undefined;
};

/** The facts of one identity, as label/value rows. */
function CraftFacts({
  craft,
  currentOwner,
  owner,
  permanent,
}: {
  readonly craft: Craft;
  readonly currentOwner: boolean;
  readonly owner: string | undefined;
  readonly permanent: boolean;
}) {
  const ownerShown = ownerValue(owner, currentOwner);
  return (
    <Panel title={applicationCopy.craft.factsPanel}>
      <DataList>
        <DataRow
          label={applicationCopy.craft.state}
          value={
            <Badge dot tone={permanent ? "live" : "neutral"}>
              {craft.stateLabel}
            </Badge>
          }
        />
        <DataRow
          label={applicationCopy.craft.track}
          value={craft.rewardTrack}
        />
        <DataRow label={applicationCopy.craft.tier} value={craft.rarityTier} />
        <DataRow
          label={applicationCopy.craft.weight}
          value={<span>{craft.rewardWeight}&times;</span>}
        />
        <DataRow
          label={applicationCopy.craft.special}
          value={craft.specialKind}
        />
        {ownerShown === undefined ? null : (
          <DataRow label={applicationCopy.craft.owner} value={ownerShown} />
        )}
        <DataRow
          label={applicationCopy.craft.launchConsequence}
          value={
            permanent
              ? applicationCopy.craft.permanentConsequence
              : applicationCopy.craft.transientConsequence
          }
        />
      </DataList>
    </Panel>
  );
}

/** The craft itself: drawn large, with its state in the panel strip. */
function CraftPortrait({
  craft,
  currentOwner,
  identityId,
  permanent,
}: {
  readonly craft: Craft;
  readonly currentOwner: boolean;
  readonly identityId: number;
  readonly permanent: boolean;
}) {
  return (
    <Panel
      meta={
        <Badge dot tone={permanent ? "live" : "neutral"}>
          {craft.stateLabel}
        </Badge>
      }
      title={applicationCopy.craft.identityPanel}
      tone={currentOwner ? "live" : "default"}
    >
      <figure className="flex flex-col items-center gap-3 rounded-[var(--radius-control)] border border-line bg-canvas p-4">
        <CraftArt
          className="h-auto w-full max-w-[16rem]"
          decorative
          identityId={identityId}
          kind={
            identityId > 4440 ? "relic" : permanent ? "permanent" : "transient"
          }
          lit={permanent}
          track={trackIndexFor(craft.rewardTrack)}
        />
        <figcaption className="font-mono text-caption text-ink-soft tabular-nums">
          #{String(identityId).padStart(4, "0")} · {craft.rewardTrack}
        </figcaption>
      </figure>
    </Panel>
  );
}

export function CraftDetailPanel({
  identityId,
}: {
  readonly identityId: number;
}) {
  const protocol = useProtocolClient();
  const directRead = useCollectibleRead(identityId, protocol);
  const wallet = loadedWallet(protocol.walletRead);
  const { craft, currentOwner, permanent, transient } = craftDetailState(
    wallet,
    directRead.data,
    protocol.address,
    identityId,
  );
  const controlsDisabledReason = transactionControlDisabledReason(
    protocol,
    directRead.data !== undefined && !directRead.isError,
  );

  if (craft === undefined) {
    return (
      <MissingCraft
        directRead={directRead}
        identityId={identityId}
        onRetry={() =>
          void Promise.all([protocol.refresh(), directRead.refetch()])
        }
        undiscovered={notDiscovered(directRead.data)}
        walletRead={protocol.walletRead}
      />
    );
  }

  const rewards = craft.pendingRewards.filter(
    (reward) => reward.rawTokenUnits > 0n,
  );
  const isPermanent = permanent !== undefined;

  return (
    <PageFrame>
      <PageHeading
        actions={<BackToCollection />}
        eyebrow={applicationCopy.craft.eyebrow}
        title={`${craft.stateLabel} #${identityId}`}
      />

      <div className="mt-4 grid gap-3 laptop:grid-cols-12 laptop:items-start">
        <div className="grid gap-3 laptop:col-span-5">
          <CraftPortrait
            craft={craft}
            currentOwner={currentOwner}
            identityId={identityId}
            permanent={isPermanent}
          />
          <CollectibleExplorerLinks identityId={identityId} />
          <CollectorHelp topic="wallet-artwork" />
        </div>

        <div className="grid gap-3 laptop:col-span-7">
          <CraftFacts
            craft={craft}
            currentOwner={currentOwner}
            owner={directOwner(directRead.data)}
            permanent={isPermanent}
          />

          <section aria-labelledby="attached-rewards-heading">
            <Panel
              title={applicationCopy.craft.attachedRewards}
              titleId="attached-rewards-heading"
            >
              <CraftRewards
                rewards={rewards}
                unavailable={craft.pendingRewardsStatus === "unavailable"}
              />
            </Panel>
          </section>

          <Panel title={applicationCopy.craft.actionsPanel}>
            <div className="grid gap-4">
              <p className="text-body-sm text-ink-soft">
                {ownerActionDisclosure(isPermanent)}
              </p>
              <LaunchSlot
                controlsDisabledReason={controlsDisabledReason}
                identityId={identityId}
                protocol={protocol}
                transientHeld={transient !== undefined && currentOwner}
                wallet={wallet}
              />
              <ClaimControl
                craft={currentOwner ? permanent : undefined}
                disabledReason={controlsDisabledReason}
                identityId={identityId}
                protocol={protocol}
                rewards={rewards}
              />
              <TransferControl
                permanent={isPermanent}
                disabledReason={controlsDisabledReason}
                identityId={identityId}
                owner={directOwner(directRead.data) ?? protocol.address}
                protocol={protocol}
                visible={currentOwner}
              />
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
