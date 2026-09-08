import { tierWeights } from "@orbit/config/collection-manifest";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";

import { ButtonLink, buttonVariants } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Address, Count } from "@/components/ui/value";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { identity } from "@/lib/identity";
import { cn } from "@/lib/utils";

/*
 * The trust and verification centre. Everything here is static: the loop, the
 * fee split, the reward methodology, the two permanent facts, the glossary and
 * the sealed contract list. Each explanation is one sentence; anything longer
 * sits behind a disclosure so the page reads as a reference, not a brochure.
 */

const repositoryUrl = "https://github.com/hrsh22/ethonline-26";
const { terms, liquidToken } = identity;
const liquid = liquidToken.displayName;
const rewardTrackList = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
}).format(identity.rewardTrackLabels.slice(1));
const explorerRoot =
  deploymentEnvironment.chainId === 8_453
    ? "https://basescan.org"
    : "https://sepolia.basescan.org";

const contractLabel = (key: string): string =>
  key
    .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/^fuel /u, `${liquid} `)
    .replace(/^usdc$/iu, "USDC")
    .replace(/^weth$/iu, "WETH")
    .replace(/^mock /u, "Test ")
    .replace(/^./u, (letter) => letter.toUpperCase());

const contractEvidence: readonly (readonly [string, string])[] =
  protocolDeploymentManifest === undefined
    ? []
    : Object.entries(protocolDeploymentManifest.contracts)
        .map(([key, address]) => [contractLabel(key), address] as const)
        .sort(([left], [right]) => left.localeCompare(right));

/* An outbound evidence link: a 44px target with the address typeset by the
 * value primitive, so the column of contracts stays aligned. */
const evidenceLink =
  "inline-flex min-h-11 items-center gap-1.5 font-mono text-body-sm text-signal underline decoration-1 underline-offset-4 hover:text-ink";

const outlineLink = cn(buttonVariants({ size: "sm", variant: "outline" }));

export const metadata = {
  title: "Learn and verify",
  description: `Understand the ${identity.brand} collecting loop, its permanent decisions, and the public evidence behind this Base Sepolia proof.`,
} satisfies Metadata;

const loop = [
  {
    title: `Buy ${liquid}`,
    body: `Use test ETH or WETH on ${identity.navigation.exchange}; every whole ${liquid} received reveals one random ${terms.transientCollectible}.`,
  },
  {
    title: "Meet the identity",
    body: `Open ${identity.navigation.collection} to see the assigned identity and its attributes; ${terms.discoveryDraw} is random and you do not choose which identity appears.`,
  },
  {
    title: `Choose whether to ${terms.commitment}`,
    body: `${terms.commitment} burns one ${liquid} forever and permanently changes that identity’s state to ${terms.permanentCollectible}.`,
  },
] as const;

function CollectorHelpTopics() {
  const topics = [
    {
      id: "discovery",
      title: "My collectible is still arriving",
      body: `Crossing a whole ${liquid} boundary records a Pending Discovery. The draw first waits for verified randomness, then the delivery service completes the onchain result. A delayed result stays recorded. Keep its backing ${liquid} in the wallet if you want to keep the discovery; moving that whole unit can cancel it. Check ${identity.navigation.collection} for the current stage and Status for service availability. Buying again or repeating a wallet prompt does not speed up delivery.`,
    },
    {
      id: "transaction",
      title: "My wallet action has not finished",
      body: "If a transaction hash exists, use its onchain link to follow that submission. Confirmation and the app's updated collection can arrive at different times. An unknown outcome is not a failed transaction, so do not submit it again. If the wallet prompt was interrupted before a hash reached the app, check wallet activity before returning to review. An expired quote needs a fresh review; cancelling a wallet prompt does not spend assets.",
    },
    {
      id: "wallet-artwork",
      title: "My collection and my wallet's NFT tab disagree",
      body: "Check the collectible's current owner and state through its onchain link. Wallets and explorers can cache an older name or state after Launch. Compare it with the current state in the app; a stale label does not undo Launch or change ownership. The current deployment uses sealed placeholder metadata; the website's illustrations are previews. Use the collection address and identity number from the detail page if your wallet supports manual NFT import.",
    },
    {
      id: "rewards",
      title: "Why are there no rewards to claim?",
      body: `${terms.commitment} makes an ordinary collectible permanent and reward-eligible. Rewards still require market activity and completed conversions. A confirmed zero means no units are currently attached to that identity for claiming; unavailable means the amount could not be checked. Queued conversion funds are not your wallet balance. Relic pots may accrue before ${terms.commitment}, but become claimable only afterward. Each token is shown separately and these Base Sepolia assets have no value.`,
    },
  ];
  return (
    <Section
      headingId="help"
      title="Help with collecting"
      description="Answers about your wallet, craft, and transactions."
    >
      <div className="grid gap-4 tablet:grid-cols-2">
        {topics.map((topic) => (
          <article key={topic.id} aria-labelledby={`help-${topic.id}`}>
            <h3
              id={`help-${topic.id}`}
              className="scroll-mt-24 text-title-sm font-semibold"
            >
              {topic.title}
            </h3>
            <p className="mt-2 max-w-[64ch] text-body text-ink-soft">
              {topic.body}
            </p>
          </article>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href="/status" variant="outline">
          Check service status
        </ButtonLink>
        <a
          className={outlineLink}
          href={`${repositoryUrl}/issues`}
          target="_blank"
          rel="noreferrer"
        >
          Report a problem
        </a>
        <a className={outlineLink} href="#verify">
          Verify contracts
        </a>
      </div>
      <p className="mt-3 text-body-sm text-ink-soft">
        The project repository is the current support channel. Include the
        public support details copied from the affected screen. There is no
        guaranteed response time or published private security-reporting
        channel. Do not post secrets or exploitable details in a public issue.
      </p>
    </Section>
  );
}

function CollectingLoop() {
  return (
    <Section
      description="Understand each action; every contract can be inspected without connecting a wallet."
      headingId="collecting-loop"
      title="The collecting loop"
    >
      <ol className="grid gap-3 tablet:grid-cols-3">
        {loop.map((step, index) => (
          <li className="min-w-0" key={step.title}>
            <Panel
              meta={<span>{String(index + 1).padStart(2, "0")}</span>}
              title={step.title}
              titleLevel={3}
            >
              <p className="text-body-sm text-ink-soft">{step.body}</p>
            </Panel>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <ButtonLink href="/explore">Explore the collection</ButtonLink>
        <ButtonLink href="/exchange" variant="outline">
          Open {identity.navigation.exchange}
        </ButtonLink>
      </div>
    </Section>
  );
}

function FeeRoutingPanel() {
  return (
    <Panel
      footer={
        <p className="text-caption text-ink-faint">
          Every market swap charges 3% on its WETH side, and the three
          destinations are fixed by the deployed protocol.
        </p>
      }
      meta={<span>3.00%</span>}
      title="Where the 3% fee goes"
      titleLevel={3}
    >
      <DataList>
        <DataRow
          label={`${terms.stockReward} conversion`}
          note={`four ${terms.rewardTrack}s`}
          value="2.00%"
        />
        <DataRow
          label={terms.protocolOwnedLiquidity}
          note="locked forever"
          value="0.85%"
        />
        <DataRow label="Creator" note="kept separate" value="0.15%" />
      </DataList>
    </Panel>
  );
}

function RewardMethodologyPanel() {
  return (
    <Panel
      footer={
        <Disclosure
          className="border-t-0"
          searchable
          title={`How ${terms.stockReward} accounting works`}
        >
          <p className="max-w-[62ch] text-body-sm text-ink-soft">
            Reward WETH is divided across the {rewardTrackList} conversion
            tracks, converted test-token units attach to eligible identities by
            weight, and unclaimed units follow the identity’s current owner.
            They are valueless test-token units, not a promise of value.
          </p>
        </Disclosure>
      }
      meta={<span>per track</span>}
      title={`${terms.stockReward} methodology`}
      titleLevel={3}
    >
      <DataList>
        <DataRow
          label={`Ordinary ${terms.permanentCollectible}s`}
          note="by tier weight"
          value="82.5%"
        />
        <DataRow
          label={`${terms.basketRelic}s`}
          note="three, equal"
          value="12.5%"
        />
        <DataRow label={terms.indicatorRelic} value="5%" />
        <DataRow label="Tier weights I–IV" value={tierWeights.join(" / ")} />
      </DataList>
    </Panel>
  );
}

function SafetyPanels() {
  return (
    <Section
      description="Two facts matter before any wallet approval."
      headingId="safety"
      title="Know before you act"
    >
      <div className="grid gap-3 laptop:grid-cols-2">
        <Panel title={`${terms.commitment} is permanent`} titleLevel={3}>
          <p className="text-body-sm text-ink-soft">
            {terms.commitment} consumes one whole {liquid} and cannot be
            reversed, so review the selected {terms.transientCollectible} and
            the wallet prompt before approving.
          </p>
        </Panel>
        <Panel title="Wallet safety" titleLevel={3}>
          <ul className="grid gap-2 text-body-sm text-ink-soft">
            <li>
              All assets are valueless test assets on Base Sepolia; nothing here
              is an investment, a promise of value, or a mainnet asset.
            </li>
            <li>
              Match the wallet request to the action you reviewed. A funding
              proof signs a message; a token approval sets a spending allowance;
              a trade, Launch, transfer, or claim submits a transaction. Wallet
              decoding varies. Cancel if the network, recipient, allowance, or
              amount is different from your review.
            </li>
            <li>This site never asks for a seed phrase or private key.</li>
          </ul>
        </Panel>
      </div>
    </Section>
  );
}

const glossary = [
  [liquid, `The liquid test token that drives ${terms.discoveryDraw}.`],
  [
    terms.transientCollectible,
    `Revealed by receiving one whole ${liquid}; dissolves if it is sold.`,
  ],
  [
    terms.permanentCollectible,
    `Created by ${terms.commitment}; never dissolved.`,
  ],
  [terms.discoveryDraw, "A random, verifiable identity draw per whole unit."],
  [terms.rewardTrack, "One tokenized stock a permanent identity earns."],
  [terms.stockReward, "Valueless test-token units, not a promise of value."],
  [terms.basketRelic, `One of three; each gets a third of the 12.5%.`],
  [terms.indicatorRelic, "The single identity that receives the 5%."],
  [terms.rewardEpoch, "One opening that moves reward WETH into tracks."],
  [terms.keeper, "The offchain process that runs openings and conversions."],
] as const;

function GlossaryPanel() {
  return (
    <Panel
      meta={<Count value={glossary.length} />}
      title="Glossary"
      titleLevel={3}
    >
      <DataList>
        {glossary.map(([term, definition]) => (
          <DataRow key={term} label={term} value={definition} />
        ))}
      </DataList>
    </Panel>
  );
}

function ContractsPanel() {
  return (
    <Panel
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/status" size="sm" variant="outline">
            Open protocol status
          </ButtonLink>
          <p className="text-caption text-ink-faint">
            Current read health, queue states and indexing freshness live there.
          </p>
        </div>
      }
      meta={<Count value={contractEvidence.length} />}
      title="Sealed deployment manifest"
      titleLevel={3}
    >
      {contractEvidence.length === 0 ? (
        <p className="text-body-sm text-ink-soft">
          No sealed deployment manifest is available in this build.
        </p>
      ) : (
        <Disclosure
          className="border-t-0"
          searchable
          title={`All ${contractEvidence.length} deployed contracts`}
        >
          <DataList>
            {contractEvidence.map(([label, address]) => (
              <DataRow
                key={label}
                label={label}
                value={
                  <a
                    className={evidenceLink}
                    href={`${explorerRoot}/address/${address}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Address value={address} />
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Open in explorer</span>
                  </a>
                }
              />
            ))}
          </DataList>
        </Disclosure>
      )}
    </Panel>
  );
}

function HistoryPanel() {
  const launch = protocolDeploymentManifest?.launch;
  return (
    <Panel
      footer={
        <a
          className={outlineLink}
          href={`${repositoryUrl}/blob/main/docs/protocol-history.md`}
          rel="noreferrer"
          target="_blank"
        >
          Open the history record
        </a>
      }
      title="Protocol history"
      titleLevel={3}
    >
      <DataList>
        <DataRow
          label="Base Sepolia launch"
          note="staging proof"
          value={
            launch ? (
              <a
                className={evidenceLink}
                href={`${explorerRoot}/tx/${launch.transactionHash}`}
                rel="noreferrer"
                target="_blank"
              >
                Block <Count value={BigInt(launch.blockNumber)} />
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : (
              "Not published"
            )
          }
        />
        <DataRow label="Mainnet" value="Not deployed" />
        <DataRow label="Recorded incidents" value="None recorded" />
      </DataList>
    </Panel>
  );
}

const limitations = [
  "Base Sepolia and all displayed assets are for testing only; there is no mainnet deployment.",
  "Web illustrations are previews. The current sealed wallet metadata remains placeholder material.",
  "Delivery status reports the latest service heartbeat and processing setting. It is not an uptime guarantee.",
  "Indexed history can lag the chain; every status surface preserves its observation time and reports partial coverage.",
  "Singapore is only a provisional operator-jurisdiction assumption and has not been validated by counsel or presented as an incorporated operating entity.",
  "No private vulnerability-reporting channel is currently published, so do not put secrets or exploitable details in a public issue.",
] as const;

function AboutPanel() {
  return (
    <Panel
      footer={
        <Disclosure className="border-t-0" searchable title="Known limitations">
          <ul className="grid max-w-[62ch] list-disc gap-2 pl-4 text-body-sm text-ink-soft">
            {limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Disclosure>
      }
      title="About and contact"
      titleLevel={3}
    >
      <p className="text-body-sm text-ink-soft">
        {identity.brand} is an open Base Sepolia proof maintained by the
        repository owner; no production operating entity is represented.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          className={outlineLink}
          href={repositoryUrl}
          rel="noreferrer"
          target="_blank"
        >
          View source
        </a>
        <a
          className={outlineLink}
          href={`${repositoryUrl}/issues`}
          rel="noreferrer"
          target="_blank"
        >
          Report a problem
        </a>
      </div>
      <p className="mt-3 text-caption text-ink-faint">
        Private security reporting is not currently published.
      </p>
    </Panel>
  );
}

export default function LearnPage() {
  return (
    <PageFrame>
      <PageHeading
        eyebrow="COLLECTOR GUIDE"
        lede="The decisions first, then the evidence behind them."
        title="Learn and verify"
      />

      <CollectorHelpTopics />
      <CollectingLoop />

      <Section
        description="One fixed split funds rewards, permanent liquidity and the creator."
        headingId="fees-and-rewards"
        title="Fees and rewards"
      >
        <div className="grid gap-3 laptop:grid-cols-2">
          <FeeRoutingPanel />
          <RewardMethodologyPanel />
        </div>
      </Section>

      <SafetyPanels />

      <Section
        description="Addresses come from the sealed deployment manifest used by this build."
        headingId="verify"
        title="Verify deployment contracts"
      >
        <div className="grid gap-3 laptop:grid-cols-2">
          <ContractsPanel />
          <GlossaryPanel />
        </div>
      </Section>

      <Section
        description="A durable record of public deployments, material changes and reported incidents."
        headingId="history"
        title="Protocol history"
      >
        <div className="grid gap-3 laptop:grid-cols-2">
          <HistoryPanel />
          <AboutPanel />
        </div>
      </Section>
    </PageFrame>
  );
}
