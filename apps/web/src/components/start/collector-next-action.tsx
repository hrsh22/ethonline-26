"use client";

import type { Route } from "next";
import { StateFeedback } from "@/components/state-feedback";
import { ButtonLink } from "@/components/ui/button";
import { WalletControl } from "@/components/wallet-control";
import type { CollectorJourneyView } from "@/lib/collector-journey";
import { applicationCopy } from "@/lib/identity";

type ReturnDestination = "/start" | "/fleet";
interface NextLink {
  readonly href: string;
  readonly label: string;
  readonly title: string;
  readonly description: string;
}

const fundingLink = (
  pending: boolean,
  returnTo: ReturnDestination,
): NextLink => ({
  href: `/faucet?returnTo=${returnTo}`,
  label: pending
    ? "View funding progress"
    : applicationCopy.onboarding.actions.faucet,
  title: pending ? "Funding is on its way" : "Your next step",
  description: pending
    ? "Your accepted request is being processed. You can leave this page while funding continues."
    : "Get valueless test ETH for gas and test WETH for trading, then return here.",
});

const returningLink = (claimable: boolean): NextLink => ({
  href: claimable ? "/rewards" : "/fleet",
  label: claimable ? "Review claimable rewards" : "Explore your Fleet",
  title: "Your collection is ready",
  description: "Continue from the collectibles you own.",
});

const nextLink = (
  journey: CollectorJourneyView,
  returnTo: ReturnDestination,
): NextLink | undefined => {
  if (journey.complete) return returningLink(journey.hasClaimableRewards);
  switch (journey.currentPhase?.action) {
    case "open-faucet":
      return fundingLink(journey.fundingPending, returnTo);
    case "open-trade":
      return {
        href: `/exchange?returnTo=${returnTo}`,
        label: applicationCopy.onboarding.actions.trade,
        title: "Your next step",
        description:
          "Choose how much $FUEL to buy. Crossing a whole-token boundary starts a random Discovery.",
      };
    case "review-launch":
      if (journey.primaryIdentityId === undefined) return undefined;
      return {
        href: `/fleet/${journey.primaryIdentityId}`,
        label: `Inspect craft #${journey.primaryIdentityId}`,
        title: "Your craft is ready to inspect",
        description:
          "Launch is optional. It burns exactly one $FUEL forever and makes this craft a permanent Orbiter.",
      };
    case "open-collection":
      return {
        href: "/fleet",
        label: applicationCopy.onboarding.actions.collection,
        title: "Your next step",
        description:
          "Your Discovery is already underway. View its progress in Fleet.",
      };
    default:
      return undefined;
  }
};

export function CollectorNextAction({
  journey,
  returnTo,
}: {
  readonly journey: CollectorJourneyView;
  readonly returnTo: ReturnDestination;
}) {
  const action = journey.currentPhase?.action;
  if (action === "connect-wallet" || action === "switch-network")
    return (
      <StateFeedback
        compact
        tone="notice"
        title="Continue collecting"
        description="Your destination stays open while you connect or switch networks."
        action={<WalletControl notices={false} />}
      />
    );
  const link = nextLink(journey, returnTo);
  if (link === undefined || (returnTo === "/fleet" && link.href === "/fleet"))
    return null;
  return (
    <StateFeedback
      compact
      tone="notice"
      title={link.title}
      description={link.description}
      action={
        <ButtonLink href={link.href as Route} size="sm">
          {link.label}
        </ButtonLink>
      }
    />
  );
}
