"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import { AccessNotice, blockedAccessMessage } from "@/components/access-notice";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { TransactionStatus } from "@/components/transaction-status";
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
import { Panel, Well } from "@/components/ui/panel";
import { Amount, Percent } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";
import { isTransactionInFlight } from "@/lib/transaction-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";
import { selectClaimIdentityBatch } from "@orbit/protocol/transactions";

/**
 * Rewards: the four tracks and their allocation rule first, so the model is
 * legible before any wallet is read; then this wallet's rewarded identities
 * and the one claim action.
 */

type WalletRead = ReturnType<typeof useProtocolClient>["walletRead"];

type RewardedCraft = Extract<
  WalletRead,
  { readonly status: "loaded" }
>["snapshot"]["collectibles"]["permanent"][number];

const TRACK_INDICES = [1, 2, 3, 4] as const;

/** The allocation split every track reserves, from CONTEXT.md. */
const ALLOCATION = [
  { label: applicationCopy.rewards.allocationOrdinary, share: 0.825 },
  { label: applicationCopy.rewards.allocationBasket, share: 0.125 },
  { label: applicationCopy.rewards.allocationIndicator, share: 0.05 },
] as const;

const rewardWalletView = (walletRead: WalletRead) => {
  switch (walletRead.status) {
    case "loading":
      return {
        feedback: {
          description: applicationCopy.rewards.loading,
          title: "Loading rewards",
          tone: "loading",
        },
        holdingsComplete: false,
        observed: false,
        permanent: [],
      } as const;
    case "failed":
      return {
        feedback: {
          description: applicationCopy.rewards.readFailed,
          title: "Rewards unavailable",
          tone: "error",
        },
        holdingsComplete: false,
        observed: false,
        permanent: [],
      } as const;
    case "blocked": {
      // A wallet on the wrong chain is connected, so the disconnected wording
      // and its connect action were both wrong: the recovery is the network
      // switch the wallet control already offers.
      const blocked = blockedAccessMessage(walletRead.accessState);
      return {
        feedback: {
          description: blocked.connectable
            ? applicationCopy.rewards.connect
            : blocked.body,
          // The title names the condition; the action offers the recovery.
          title: blocked.title,
          tone: "blocked",
        },
        // A block that is only a missing wallet has an obvious way out.
        connectable: blocked.connectable,
        holdingsComplete: false,
        observed: false,
        permanent: [],
      } as const;
    }
    case "loaded": {
      const holdingsComplete =
        walletRead.snapshot.collectibles.permanentHoldingsStatus === "complete";
      return {
        feedback: holdingsComplete
          ? ({
              description: applicationCopy.rewards.empty,
              title: "No claimable rewards",
              tone: "empty",
            } as const)
          : ({
              description: applicationCopy.fleet.partial,
              title: "Reward data is incomplete",
              tone: "partial",
            } as const),
        holdingsComplete,
        observed: holdingsComplete,
        permanent: walletRead.snapshot.collectibles.permanent,
      } as const;
    }
  }
};

type RewardWalletView = ReturnType<typeof rewardWalletView>;

const shouldShowAccessNotice = (
  holdingsComplete: boolean,
  rewardCount: number,
): boolean => holdingsComplete && rewardCount > 0;

const claimTotalsFor = (craft: RewardedCraft): bigint =>
  craft.pendingRewards.reduce(
    (total, reward) => total + reward.rawTokenUnits,
    0n,
  );

/** Units of one track claimable now: only eligible identities count. */
const claimableForTrack = (
  crafts: readonly RewardedCraft[],
  track: string,
): bigint =>
  crafts
    .filter((craft) => craft.claimEligible)
    .flatMap((craft) => craft.pendingRewards)
    .filter((reward) => reward.track === track)
    .reduce((total, reward) => total + reward.rawTokenUnits, 0n);

const trackIndexFor = (craft: RewardedCraft): number => {
  const index = identity.rewardTrackLabels.indexOf(
    craft.rewardTrack as (typeof identity.rewardTrackLabels)[number],
  );
  return index > 0 ? index : 1;
};

function TrackPanel({
  index,
  rewarded,
  view,
}: {
  readonly index: (typeof TRACK_INDICES)[number];
  readonly rewarded: readonly RewardedCraft[];
  readonly view: RewardWalletView;
}) {
  const track = identity.rewardTrackLabels[index];
  const claimable = view.observed
    ? claimableForTrack(rewarded, track)
    : undefined;
  return (
    <li className="min-w-0" data-reward-track={track}>
      <Panel
        className="h-full"
        meta={<span>{applicationCopy.rewards.trackMeta(index)}</span>}
        title={track}
        tone={claimable !== undefined && claimable > 0n ? "live" : "default"}
      >
        <DataList>
          {ALLOCATION.map((entry) => (
            <DataRow
              key={entry.label}
              label={entry.label}
              value={<Percent fractionDigits={1} value={entry.share} />}
            />
          ))}
          {claimable === undefined ? null : (
            <DataRow
              label={applicationCopy.rewards.claimable}
              tone={claimable > 0n ? "live" : "default"}
              value={<Amount unit={track} value={claimable} />}
            />
          )}
        </DataList>
      </Panel>
    </li>
  );
}

/**
 * A batch claim spends gas across several identities at once. The review
 * lists exactly which identities are included and what each will claim
 * before the wallet is asked to sign.
 */
function ClaimReview({
  batch,
  disabledReason,
  onConfirm,
  rewarded,
}: {
  readonly batch: readonly number[];
  readonly disabledReason: string | undefined;
  readonly onConfirm: () => void;
  readonly rewarded: readonly RewardedCraft[];
}) {
  const included = rewarded.filter((craft) => batch.includes(craft.identityId));
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        aria-describedby={
          disabledReason === undefined
            ? undefined
            : "rewards-claim-disabled-reason"
        }
        className={buttonVariants({ size: "lg" })}
        disabled={disabledReason !== undefined}
      >
        {applicationCopy.rewards.claim}
      </AlertDialog.Trigger>
      {disabledReason === undefined ? null : (
        <DisabledReason id="rewards-claim-disabled-reason">
          {disabledReason}
        </DisabledReason>
      )}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={dialogBackdropClassName} />
        <AlertDialog.Popup className={dialogPopupClassName}>
          <AlertDialog.Title className={dialogTitleClassName}>
            {applicationCopy.rewards.reviewTitle}
          </AlertDialog.Title>
          <AlertDialog.Description className={dialogDescriptionClassName}>
            {applicationCopy.rewards.reviewIntroduction}
          </AlertDialog.Description>
          <DataList className="mt-4">
            {included.map((craft) => (
              <DataRow
                key={craft.identityId}
                label={`#${craft.identityId}`}
                value={
                  <span
                    className="font-mono"
                    title={claimTotalsFor(craft).toString()}
                  >
                    <Amount value={claimTotalsFor(craft)} />
                  </span>
                }
              />
            ))}
          </DataList>
          <div className={dialogActionsClassName}>
            <AlertDialog.Close
              className={buttonVariants({ variant: "outline" })}
            >
              {applicationCopy.rewards.cancelClaim}
            </AlertDialog.Close>
            <AlertDialog.Close className={buttonVariants()} onClick={onConfirm}>
              {applicationCopy.rewards.confirmClaim}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function ClaimAction({
  batch,
  disabledReason,
  onConfirm,
  rewarded,
}: {
  readonly batch: readonly number[];
  readonly disabledReason: string | undefined;
  readonly onConfirm: () => void;
  readonly rewarded: readonly RewardedCraft[];
}) {
  if (batch.length > 1) {
    return (
      <ClaimReview
        batch={batch}
        disabledReason={disabledReason}
        onConfirm={onConfirm}
        rewarded={rewarded}
      />
    );
  }
  return (
    <>
      <Button
        aria-describedby={
          disabledReason === undefined
            ? undefined
            : "rewards-claim-disabled-reason"
        }
        disabled={disabledReason !== undefined}
        onClick={onConfirm}
        size="lg"
        type="button"
      >
        {applicationCopy.rewards.claim}
      </Button>
      {disabledReason === undefined ? null : (
        <DisabledReason id="rewards-claim-disabled-reason">
          {disabledReason}
        </DisabledReason>
      )}
    </>
  );
}

const positiveRewards = (craft: RewardedCraft) =>
  craft.pendingRewards.filter((reward) => reward.rawTokenUnits > 0n);

/** One identity's accrued rewards: its face, its number, its state, its units. */
function RewardRow({ craft }: { readonly craft: RewardedCraft }) {
  return (
    <Well className="grid gap-3 compact:grid-cols-[4rem_minmax(0,1fr)]">
      <CraftArt
        className="size-16"
        decorative
        identityId={craft.identityId}
        kind="permanent"
        track={trackIndexFor(craft)}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-mono text-title-sm font-semibold tabular-nums">
            #{String(craft.identityId).padStart(4, "0")}
            <span className="ml-2 text-label font-medium tracking-[0.1em] text-ink-faint uppercase">
              {craft.stateLabel}
            </span>
          </h3>
          <Badge dot tone={craft.claimEligible ? "success" : "warning"}>
            {craft.claimEligible
              ? applicationCopy.rewards.eligible
              : applicationCopy.rewards.gated}
          </Badge>
        </div>
        <DataList className="mt-2">
          {positiveRewards(craft).map((reward) => (
            <DataRow
              key={reward.track}
              label={reward.track}
              tone={craft.claimEligible ? "live" : "default"}
              value={
                <Amount unit={reward.track} value={reward.rawTokenUnits} />
              }
            />
          ))}
        </DataList>
        {/* A denial states what happens to the accrued rewards and how the
            same entitlement becomes claimable, rather than naming a contract
            as having failed. */}
        {craft.claimEligible ? null : (
          <Disclosure className="mt-2" title={applicationCopy.rewards.gated}>
            <p className="max-w-[62ch] text-body-sm text-ink-soft">
              {applicationCopy.rewards.gatedExplanation}
            </p>
          </Disclosure>
        )}
        {/* The exact integer is evidence, not the displayed value. */}
        <Disclosure
          className="mt-2"
          searchable
          title={applicationCopy.rewards.rawUnitsDisclosure}
        >
          <DataList>
            {positiveRewards(craft).map((reward) => (
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
      </div>
    </Well>
  );
}

function RewardRecoveryAction({
  rewardCount,
  walletView,
}: {
  readonly rewardCount: number;
  readonly walletView: RewardWalletView;
}) {
  if ("connectable" in walletView)
    return walletView.connectable ? <ConnectWalletAction /> : null;
  if (walletView.holdingsComplete && rewardCount === 0) {
    return (
      <ButtonLink href="/fleet" size="sm" variant="outline">
        Review {identity.navigation.collection}
      </ButtonLink>
    );
  }
  return null;
}

const claimDisabledReasonFor = (
  accessReady: boolean,
  transactionPending: boolean,
  holdingsComplete: boolean,
  batchSize: number,
): string | undefined => {
  if (!accessReady) {
    return "Connect the wallet on the supported network before claiming rewards.";
  }
  if (transactionPending) {
    return "Wait for the current transaction to finish before claiming rewards.";
  }
  if (!holdingsComplete) {
    return "Wait for complete holdings data before claiming rewards.";
  }
  if (batchSize === 0) {
    return "No eligible rewards are currently available to claim.";
  }
  return undefined;
};

function PolicyDisclosure() {
  return (
    <Disclosure searchable title={applicationCopy.rewards.policyDisclosure}>
      <p className="max-w-[62ch] text-body-sm text-ink-soft">
        {applicationCopy.rewards.currentOwner}
      </p>
      <p className="mt-2 max-w-[62ch] text-body-sm text-ink-soft">
        {applicationCopy.rewards.units}
      </p>
    </Disclosure>
  );
}

export function RewardsPanel() {
  const protocol = useProtocolClient();
  const walletView = rewardWalletView(protocol.walletRead);
  const rewarded = walletView.permanent.filter(
    (craft) => positiveRewards(craft).length > 0,
  );
  const eligibleIds = rewarded
    .filter((craft) => craft.claimEligible)
    .map((craft) => craft.identityId);
  const claimBatch = selectClaimIdentityBatch(eligibleIds);
  const showAccessNotice = shouldShowAccessNotice(
    walletView.holdingsComplete,
    rewarded.length,
  );
  const claimDisabledReason = claimDisabledReasonFor(
    protocol.accessState === "ready",
    isTransactionInFlight(protocol.transaction),
    walletView.holdingsComplete,
    claimBatch.length,
  );
  const showFeedback = rewarded.length === 0 || !walletView.holdingsComplete;

  return (
    <div className="mt-5 grid gap-3">
      <ul
        aria-label={applicationCopy.rewards.tracksLabel}
        className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-4"
      >
        {TRACK_INDICES.map((index) => (
          <TrackPanel
            index={index}
            key={index}
            rewarded={rewarded}
            view={walletView}
          />
        ))}
      </ul>

      {/* A blocked or partial read is announced before the ledger it blocks. */}
      {showAccessNotice ? <AccessNotice /> : null}

      <Panel
        bodyClassName="grid gap-3"
        meta={
          rewarded.length === 0 ? undefined : (
            <span>
              {applicationCopy.rewards.holdingsTitle(rewarded.length)}
            </span>
          )
        }
        title={applicationCopy.rewards.claimTitle}
        tone={claimBatch.length > 0 ? "live" : "default"}
      >
        {showFeedback ? (
          <StateFeedback
            {...walletView.feedback}
            action={
              <RewardRecoveryAction
                rewardCount={rewarded.length}
                walletView={walletView}
              />
            }
            compact
          />
        ) : null}
        {rewarded.map((craft) => (
          <RewardRow craft={craft} key={craft.identityId} />
        ))}
        {/* The claim decision closes the ledger, separated from the evidence
            rows above it so the one action on this route reads on its own. */}
        <div className="grid gap-3 border-t border-line pt-4">
          <div>
            <ClaimAction
              batch={claimBatch}
              disabledReason={claimDisabledReason}
              onConfirm={() =>
                protocol.execute(
                  { type: "claim", identityIds: claimBatch },
                  applicationCopy.rewards.claim,
                )
              }
              rewarded={rewarded}
            />
          </div>
          <TransactionStatus
            onRetry={() => void protocol.retry()}
            state={protocol.transaction}
          />
        </div>
      </Panel>

      <PolicyDisclosure />
    </div>
  );
}
