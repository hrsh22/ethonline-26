"use client";

import { RewardFundingPanel } from "./reward-funding-panel";
import { CollectorHelp } from "@/components/collector-help";
import { useState } from "react";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import { AccessNotice, blockedAccessMessage } from "@/components/access-notice";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonVariants } from "@/components/ui/button";
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
import { Amount, Percent, Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";
import { isTransactionInFlight } from "@/lib/transaction-state";
import { useProtocolClient } from "@/providers/protocol-client-provider";
import { selectClaimIdentityBatch } from "@orbit/protocol/transactions";

/** Connected rewards lead with the current owner’s verified claim. */

type WalletRead = ReturnType<typeof useProtocolClient>["walletRead"];

type RewardedCraft = Extract<
  WalletRead,
  { readonly status: "loaded" }
>["snapshot"]["collectibles"]["permanent"][number];

const hasRewardEvidence = (craft: RewardedCraft): boolean =>
  craft.pendingRewardsStatus !== "unavailable" &&
  craft.claimEligibilityStatus !== "unavailable";
const canClaimRewards = (craft: RewardedCraft): boolean =>
  craft.claimEligible && hasRewardEvidence(craft);

const TRACK_INDICES = [1, 2, 3, 4] as const;
const TRACK_COMPANIES: Record<string, string> = {
  AAPLc: "Apple",
  GOOGLc: "Alphabet",
  METAc: "Meta",
  NVDAc: "NVIDIA",
};

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
          tone: blocked.tone,
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
      const rewardsComplete =
        walletRead.snapshot.collectibles.permanent.every(hasRewardEvidence);
      return {
        feedback:
          holdingsComplete && rewardsComplete
            ? ({
                description:
                  walletRead.snapshot.collectibles.permanent.length === 0
                    ? "Launch a Grounded Craft to make it permanent and reward-eligible. Review your Fleet when you are ready."
                    : walletRead.snapshot.collectibles.permanent.some(
                          (craft) => craft.claimEligible,
                        )
                      ? "Your Orbiter is eligible, but no rewards are currently available to claim. Rewards depend on market activity and completed conversions; there is no guaranteed amount or payout time."
                      : "No rewards are currently claimable. Reward activation and the current owner determine whether an identity can claim.",
                title: "No claimable rewards",
                tone: "empty",
              } as const)
            : ({
                description:
                  "Some rewards are still updating. Known amounts are shown below; missing amounts are not included. We will check again automatically.",
                title: "Reward data is incomplete",
                tone: "partial",
              } as const),
        holdingsComplete,
        observed: true,
        rewardsComplete,
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

/** Units of one track claimable now: only eligible identities count. */
const claimableForTrack = (
  crafts: readonly RewardedCraft[],
  track: string,
): bigint =>
  crafts
    .filter(canClaimRewards)
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
}: {
  readonly index: (typeof TRACK_INDICES)[number];
}) {
  const track = identity.rewardTrackLabels[index];
  return (
    <li className="min-w-0" data-reward-track={track}>
      <Panel
        className="h-full"
        meta={<span>{applicationCopy.rewards.trackMeta(index)}</span>}
        title={`${TRACK_COMPANIES[track] ?? track} · ${track}`}
      >
        <DataList>
          {ALLOCATION.map((entry) => (
            <DataRow
              key={entry.label}
              label={entry.label}
              value={<Percent fractionDigits={1} value={entry.share} />}
            />
          ))}
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
function ClaimCoverage({
  count,
  remaining,
}: {
  readonly count: number;
  readonly remaining: number;
}) {
  return (
    <>
      <p className="mt-4 text-body-sm">
        {count} {count === 1 ? "identity" : "identities"} in this claim.
      </p>
      {remaining > 0 ? (
        <p className="mt-2 text-body-sm text-ink-soft">
          This transaction covers up to 64 identities. {remaining} more eligible{" "}
          {remaining === 1 ? "identity remains" : "identities remain"} for a
          later claim.
        </p>
      ) : null}
    </>
  );
}

export function ClaimReview({
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
  const current = rewarded.filter((craft) => batch.includes(craft.identityId));
  const [reviewed, setReviewed] = useState<readonly RewardedCraft[] | null>(
    null,
  );
  const included = reviewed ?? current;
  const terms = (crafts: readonly RewardedCraft[]) =>
    crafts
      .map(
        (craft) =>
          `${craft.identityId}:${craft.pendingRewardsStatus}:${craft.claimEligible}:${craft.claimEligibilityStatus}:${craft.pendingRewards.map((reward) => `${reward.track}:${reward.rawTokenUnits}`).join(",")}`,
      )
      .join(";");
  const changed = reviewed !== null && terms(reviewed) !== terms(current);
  const remaining = rewarded.filter(canClaimRewards).length - batch.length;
  return (
    <AlertDialog.Root
      onOpenChange={(open) => setReviewed(open ? current : null)}
    >
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
          <ClaimCoverage count={included.length} remaining={remaining} />
          {rewarded.some(
            (craft) =>
              craft.pendingRewardsStatus === "unavailable" ||
              craft.claimEligibilityStatus === "unavailable",
          ) ? (
            <p className="mt-2 text-body-sm">
              Known rewards only. Identities still updating are not included in
              this claim.
            </p>
          ) : null}
          {changed ? (
            <p role="status" className="mt-2 text-body-sm">
              Rewards changed. Close this review and review the updated claim.
            </p>
          ) : null}
          <DataList className="mt-4">
            {TRACK_INDICES.map((index) => {
              const track = identity.rewardTrackLabels[index];
              const amount = claimableForTrack(included, track);
              return amount > 0n ? (
                <DataRow
                  key={track}
                  label={track}
                  value={<Amount unit={track} value={amount} />}
                />
              ) : null;
            })}
          </DataList>
          <Disclosure
            className="mt-3"
            title="Identities included in this claim"
          >
            {included.map((craft) => (
              <DataList key={craft.identityId} className="mt-2">
                {positiveRewards(craft).map((reward) => (
                  <DataRow
                    key={reward.track}
                    label={`#${craft.identityId} · ${reward.track}`}
                    value={
                      <Amount
                        unit={reward.track}
                        value={reward.rawTokenUnits}
                      />
                    }
                  />
                ))}
              </DataList>
            ))}
          </Disclosure>
          <div className={dialogActionsClassName}>
            <AlertDialog.Close
              className={buttonVariants({ variant: "outline" })}
            >
              {applicationCopy.rewards.cancelClaim}
            </AlertDialog.Close>
            <AlertDialog.Close
              className={buttonVariants()}
              disabled={changed || disabledReason !== undefined}
              onClick={() => {
                if (!changed && disabledReason === undefined) onConfirm();
              }}
            >
              {applicationCopy.rewards.confirmClaim}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const positiveRewards = (craft: RewardedCraft) =>
  craft.pendingRewardsStatus === "unavailable"
    ? []
    : craft.pendingRewards.filter((reward) => reward.rawTokenUnits > 0n);

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
            {craft.claimEligibilityStatus === "unavailable"
              ? "Eligibility is updating"
              : craft.claimEligible
                ? applicationCopy.rewards.eligible
                : applicationCopy.rewards.gated}
          </Badge>
        </div>
        {craft.pendingRewardsStatus === "unavailable" ? (
          <p className="mt-2 text-body-sm text-ink-soft">
            Rewards unavailable for #{craft.identityId}. We will check again
            automatically.
          </p>
        ) : null}
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
        {craft.claimEligible ||
        craft.claimEligibilityStatus === "unavailable" ? null : (
          <Disclosure className="mt-2" title={applicationCopy.rewards.gated}>
            <p className="max-w-[62ch] text-body-sm text-ink-soft">
              Reward activation and this deployment’s claim policy do not
              currently allow this claim. Attached rewards stay with the
              identity.
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

function ClaimableSummary({
  walletView,
  rewarded,
}: {
  readonly walletView: RewardWalletView;
  readonly rewarded: readonly RewardedCraft[];
}) {
  const incomplete =
    !walletView.holdingsComplete ||
    ("rewardsComplete" in walletView && !walletView.rewardsComplete);
  return (
    <>
      <p className="text-body-sm text-ink-soft">
        Valueless test tokens on Base Sepolia. Company names identify the test
        Reward Tracks; these are not shares or promised income.
      </p>
      {walletView.observed ? (
        <DataList>
          {TRACK_INDICES.map((index) => {
            const track = identity.rewardTrackLabels[index];
            const amount = claimableForTrack(rewarded, track);
            return (
              <DataRow
                key={track}
                label={`${TRACK_COMPANIES[track] ?? track} · ${track}`}
                value={
                  incomplete && amount === 0n ? (
                    <Unavailable reason="Rewards are still updating" />
                  ) : (
                    <Amount unit={track} value={amount} />
                  )
                }
              />
            );
          })}
        </DataList>
      ) : null}
      {walletView.observed ? (
        <p className="text-caption text-ink-soft">
          {"rewardsComplete" in walletView &&
          (!walletView.rewardsComplete || !walletView.holdingsComplete)
            ? "Known claimable amounts only. Rewards that are still updating are excluded."
            : applicationCopy.rewards.claimable}
        </p>
      ) : null}
    </>
  );
}

const walletIsStale = (walletRead: WalletRead) =>
  walletRead.status === "loaded" && walletRead.stale === true;

export function RewardsPanel() {
  const protocol = useProtocolClient();
  const walletView = rewardWalletView(protocol.walletRead);
  const rewarded = walletView.permanent.filter(
    (craft) => positiveRewards(craft).length > 0 || !hasRewardEvidence(craft),
  );
  const eligibleIds = rewarded
    .filter(canClaimRewards)
    .map((craft) => craft.identityId);
  const claimBatch = selectClaimIdentityBatch(eligibleIds);
  const showAccessNotice = shouldShowAccessNotice(
    walletView.holdingsComplete,
    rewarded.length,
  );
  const stale = walletIsStale(protocol.walletRead);
  const claimDisabledReason = stale
    ? "Wait for refreshed ownership and rewards before claiming."
    : claimDisabledReasonFor(
        protocol.accessState === "ready",
        isTransactionInFlight(protocol.transaction),
        walletView.holdingsComplete,
        claimBatch.length,
      );
  const showFeedback =
    rewarded.length === 0 ||
    !walletView.holdingsComplete ||
    ("rewardsComplete" in walletView && !walletView.rewardsComplete);

  return (
    <div className="mt-5 grid gap-3">
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
        <ClaimableSummary walletView={walletView} rewarded={rewarded} />
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
            <ClaimReview
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
        </div>
      </Panel>

      <RewardFundingPanel />
      <CollectorHelp topic="rewards" />
      <Panel title="How rewards reach your wallet">
        <p className="text-body-sm text-ink-soft">
          Trading fees fund conversions into the four reward tokens. Completed
          conversions attach rewards to eligible identities. The current owner
          reviews and claims those attached tokens.
        </p>
        <p className="mt-2 text-body-sm text-ink-soft">
          Queued conversions are shared protocol funds, not your wallet’s
          claimable balance. Station and Observatory pots can accrue before
          Launch, but become claimable only after Launch. An ordinary track’s
          unclaimed pot is reserved until its first ordinary Orbiter becomes
          eligible.
        </p>
      </Panel>
      <Disclosure title="Reward allocation by track" searchable>
        <ul
          aria-label={applicationCopy.rewards.tracksLabel}
          className="grid gap-3 tablet:grid-cols-2 laptop:grid-cols-4"
        >
          {TRACK_INDICES.map((index) => (
            <TrackPanel index={index} key={index} />
          ))}
        </ul>
      </Disclosure>
      <PolicyDisclosure />
    </div>
  );
}
