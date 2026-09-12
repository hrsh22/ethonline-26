"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  MINIMUM_REWARD_EPOCH_INTERVAL,
  MINIMUM_REWARD_EPOCH_WETH,
} from "@orbit/protocol/operator-policy";
import {
  useDeliveryStatus,
  type DeliveryCondition,
} from "@/hooks/use-delivery-status";
import { useObservationExpiry } from "@/hooks/use-observation-expiry";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Amount, Count, Percent } from "@/components/ui/value";
import { Disclosure } from "@/components/ui/disclosure";
import { rewardCycleProgress } from "@/lib/reward-progress";
import { identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type Protocol = ReturnType<typeof useProtocolClient>;
type Health = NonNullable<Protocol["health"]>;
type Wallet = Protocol["walletRead"];

const processorLabels: Record<DeliveryCondition, string> = {
  running: "Automatic processing is online",
  stopped: "Automatic processing is stopped",
  offline: "Automatic processing is offline",
  checking: "Checks only — automatic processing is not enabled",
  delayed: "The last processing run failed; awaiting recovery",
  unknown: "Automatic processing status is unavailable",
};

/** Reuse active protocol queries; poll only while this view is visible. */
function useProgressRefresh() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      for (const key of [
        "protocol-health",
        "protocol-wallet",
        "public-protocol-status",
        "delivery-status",
      ]) {
        void queryClient.refetchQueries(
          { queryKey: [key], type: "active" },
          { cancelRefetch: false },
        );
      }
    };
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [queryClient]);
}

function OrbiterTracks({ wallet }: { readonly wallet: Wallet }) {
  if (wallet.status !== "loaded")
    return (
      <p>
        Connect your wallet to see which reward tracks your Orbiters participate
        in.
      </p>
    );
  const { permanent, permanentHoldingsStatus } = wallet.snapshot.collectibles;
  if (wallet.stale || permanentHoldingsStatus !== "complete")
    return (
      <p>
        Your Orbiter ownership is updating. Eligibility will appear after it is
        verified.
      </p>
    );
  if (permanent.length === 0)
    return (
      <p>
        Launch a Grounded Craft to make it a reward-earning Orbiter. Holding
        FUEL alone does not earn these rewards.{" "}
        <Link className="underline" href="/fleet">
          View your collection
        </Link>
      </p>
    );
  const groups = new Map<string, typeof permanent>();
  for (const craft of permanent) {
    const track =
      craft.identityId > 4440 ? "All four tracks" : craft.rewardTrack;
    groups.set(track, [...(groups.get(track) ?? []), craft]);
  }
  return (
    <div className="grid gap-2">
      <p>
        <Count value={permanent.length} />{" "}
        {permanent.length === 1
          ? "Orbiter participates"
          : "Orbiters participate"}{" "}
        in future reward distributions.
      </p>
      <ul className="flex flex-wrap gap-2">
        {[...groups].map(([track, craft]) => (
          <li className="rounded border border-line px-3 py-2" key={track}>
            <strong>{track}</strong> · <Count value={craft.length} />{" "}
            {craft.length === 1 ? "Orbiter" : "Orbiters"}
          </li>
        ))}
      </ul>
      <p className="text-body-sm text-ink-soft">
        Rewards accrue to your Orbiter after its track converts successfully.
        Use Claim below to send available rewards to your wallet.
      </p>
    </div>
  );
}

function CycleConditions({
  health,
  service,
}: {
  readonly health: Health | undefined;
  readonly service: DeliveryCondition;
}) {
  const model = progressFromHealth(health);
  return (
    <div className="grid gap-5">
      <PoolProgress pot={health?.market.rewardPotWeth} model={model} />
      <div className="grid gap-3 border-t border-line pt-4 tablet:grid-cols-2">
        <div>
          <h3 className="font-semibold">Cycle timing</h3>
          <p className="mt-1">
            {model.secondsRemaining === undefined ? (
              "Timing could not be verified"
            ) : model.secondsRemaining === 0 ? (
              "Minimum wait is satisfied"
            ) : (
              <>
                <Count value={model.secondsRemaining} /> seconds left at the
                last check
              </>
            )}
          </p>
          <p className="mt-1 text-body-sm text-ink-soft">
            At least <Count value={MINIMUM_REWARD_EPOCH_INTERVAL} /> seconds
            between cycle openings. This is not a payout schedule.
          </p>
        </div>
        <div>
          <h3 className="font-semibold">Processing</h3>
          <p className="mt-1">{processorLabels[service]}</p>
          <p className="mt-1 text-body-sm text-ink-soft">
            {conversionLabels[model.conversion]}
          </p>
        </div>
      </div>
      {model.canOpen ? (
        <p className="text-body-sm">
          The onchain conditions above are met.{" "}
          {service === "running"
            ? "Waiting for the processor to open the next cycle."
            : "Processing must be available before the next cycle can open."}{" "}
          This does not yet mean rewards are claimable.
        </p>
      ) : null}
    </div>
  );
}

const conversionLabels = {
  paused: "Reward conversion or accounting is paused onchain.",
  unconfigured: "Reward routes are not yet sealed.",
  unknown: "Onchain processing conditions could not be verified.",
  enabled:
    "Reward routes are configured and conversion/accounting are not paused. Each conversion still needs a valid quote and a successful transaction.",
};

function progressFromHealth(health: Health | undefined) {
  return rewardCycleProgress({
    rewardPotWeth: health?.market.rewardPotWeth,
    nextEpochAt: health?.operations.nextRewardEpochAt,
    observedAt: health?.deployment.observedAt,
    routesSealed: health?.deployment.seals.conversionRoutes,
    converterPaused: health?.pauses.converter,
    rewardsPaused: health?.pauses.rewards,
  });
}

function PoolProgress({
  pot,
  model,
}: {
  readonly pot: bigint | undefined;
  readonly model: ReturnType<typeof rewardCycleProgress>;
}) {
  return (
    <div>
      <h3 className="font-semibold">Fill the next reward pool</h3>
      <p className="mt-1 text-body-sm text-ink-soft">
        2% of WETH-side FUEL trading volume funds rewards. A new cycle can open
        once this pool reaches{" "}
        <Amount value={MINIMUM_REWARD_EPOCH_WETH} unit="WETH" />.
      </p>
      {pot === undefined ? (
        <p className="mt-3">Reward pool balance is unavailable—not zero.</p>
      ) : (
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p>
              <Amount value={pot} unit="WETH" /> of{" "}
              <Amount value={MINIMUM_REWARD_EPOCH_WETH} unit="WETH" />
            </p>
            <Percent value={(model.percent ?? 0) / 100} fractionDigits={2} />
          </div>
          <progress
            className="h-2 w-full overflow-hidden rounded bg-surface-3 accent-signal [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:bg-signal"
            max={100}
            value={model.percent}
            aria-label="Funding for the next reward cycle"
          />
          <p className="text-body-sm text-ink-soft">
            {model.funded ? (
              "Funding minimum reached."
            ) : (
              <>
                <Amount value={model.remainingWeth!} unit="WETH" /> more needed.
                Timing depends on market activity.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function queueExplanation(
  queue: Health["operations"]["trackQueues"][number] | undefined,
  paused: boolean,
) {
  if (queue?.weth === undefined) return "No conversion status can be inferred.";
  if (queue.weth === 0n)
    return "No queued budget. Existing claimable rewards are shown below.";
  if (paused) return "Conversion is paused. This budget remains reserved.";
  if (queue.deferred === true)
    return "The previous conversion did not complete. This budget is reserved for retry.";
  return "Budget reserved. Waiting for a successful conversion; completion has not been confirmed.";
}

function TrackProgress({
  health,
  wallet,
}: {
  readonly health: Health | undefined;
  readonly wallet: Wallet;
}) {
  const owned =
    wallet.status === "loaded" && !wallet.stale
      ? wallet.snapshot.collectibles.permanent
      : [];
  const hasRelic = owned.some((craft) => craft.identityId > 4440);
  return (
    <div className="border-t border-line pt-4">
      <h3 className="font-semibold">Convert each reward track</h3>
      <p className="mt-1 max-w-3xl text-body-sm text-ink-soft">
        Each cycle divides its WETH budget equally across four tracks. Queued
        funds can convert even while the next pool is still filling. A failed
        track keeps its budget for retry; it does not block the others.
      </p>
      <ul className="mt-3 grid gap-2 tablet:grid-cols-2">
        {identity.rewardTrackLabels.slice(1).map((track) => {
          const queue = health?.operations.trackQueues.find(
            (row) => row.track === track,
          );
          const yours =
            hasRelic || owned.some((craft) => craft.rewardTrack === track);
          const paused =
            health?.pauses.converter === true ||
            health?.pauses.rewards === true;
          return (
            <li key={track} className="min-w-0 rounded border border-line p-3">
              <h4 className="font-semibold">
                {track}
                {yours ? (
                  <span className="ml-2 text-body-sm font-normal text-signal">
                    Your track
                  </span>
                ) : null}
              </h4>
              <p className="mt-1">
                {queue?.weth === undefined ? (
                  "Queue unavailable"
                ) : (
                  <>
                    <Amount value={queue.weth} unit="WETH" /> awaiting
                    conversion
                  </>
                )}
              </p>
              <p className="mt-1 text-body-sm text-ink-soft">
                {queueExplanation(queue, paused)}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RewardProgressEvidence({
  health,
  wallet,
  service,
  stale = false,
}: {
  readonly health: Health | undefined;
  readonly wallet: Wallet;
  readonly service: DeliveryCondition;
  readonly stale?: boolean;
}) {
  // Keep stale observations explicitly separate; don't label old thresholds ready.
  return (
    <Panel title="Reward progress" bodyClassName="grid gap-5">
      <div>
        <h2 className="text-heading font-semibold">
          When will my Orbiter receive rewards?
        </h2>
        <p className="mt-2 max-w-3xl text-body text-ink-soft">
          Rewards follow trading activity, not a fixed date. These are valueless
          Base Sepolia test tokens—not company shares or guaranteed income.
        </p>
      </div>
      <OrbiterTracks wallet={wallet} />
      {stale ? (
        <p className="text-body-sm text-warning">
          Refreshing reward progress. The last observation is out of date;
          current conditions are not yet verified.
        </p>
      ) : null}
      <CycleConditions health={stale ? undefined : health} service={service} />
      <TrackProgress health={stale ? undefined : health} wallet={wallet} />
      <Disclosure title="How your share is calculated">
        <p className="text-body-sm">
          Each converted track assigns 82.5% to its ordinary Orbiters by rarity
          weight, 12.5% equally to the three Stations, and 5% to the
          Observatory. More active Orbiters in a track change the share of
          future rewards. If a track has no ordinary Orbiter, its ordinary share
          waits for the first one launched.
        </p>
        <p className="mt-2 text-body-sm text-ink-soft">
          Unclaimed rewards stay attached to the Orbiter and transfer with it.
          Only its current owner can claim. WETH waiting for conversion is not a
          personal reward balance; the amount you can claim is verified
          separately below.
        </p>
      </Disclosure>
      {health === undefined ? null : (
        <p className="text-caption text-ink-faint">
          Checked{" "}
          <time
            dateTime={new Date(
              health.deployment.observedAt * 1000,
            ).toISOString()}
          >
            {new Date(health.deployment.observedAt * 1000).toLocaleTimeString()}
          </time>
          . Refreshes every 30 seconds while this view is visible.
        </p>
      )}
    </Panel>
  );
}

export function RewardProgressPanel() {
  const protocol = useProtocolClient();
  const service = useDeliveryStatus();
  useProgressRefresh();
  const expired = useObservationExpiry(
    protocol.health === undefined
      ? undefined
      : protocol.health.deployment.observedAt * 1000 + 60_000,
  );
  return (
    <section className="mt-5 grid gap-3" aria-label="Reward progress">
      <RewardProgressEvidence
        health={protocol.health}
        wallet={protocol.walletRead}
        service={service.state}
        stale={
          protocol.health !== undefined &&
          (expired || protocol.healthError !== null)
        }
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={protocol.healthRefreshing}
          onClick={() =>
            void Promise.allSettled([protocol.refresh(), service.refresh()])
          }
        >
          {protocol.healthRefreshing
            ? "Refreshing…"
            : "Refresh reward progress"}
        </Button>
      </div>
    </section>
  );
}
