import { Schema } from "effect";

export const IdentityConfigurationSchema = Schema.Struct({
  key: Schema.Literal("orbit-4444", "neutral-test"),
  brand: Schema.String,
  liquidToken: Schema.Struct({
    displayName: Schema.String,
    name: Schema.String,
    symbol: Schema.String,
  }),
  collectibleToken: Schema.Struct({
    name: Schema.String,
    symbol: Schema.String,
  }),
  rewardTrackLabels: Schema.Tuple(
    Schema.String,
    Schema.String,
    Schema.String,
    Schema.String,
    Schema.String,
  ),
  rarityTierLabels: Schema.Tuple(
    Schema.String,
    Schema.String,
    Schema.String,
    Schema.String,
    Schema.String,
  ),
  terms: Schema.Struct({
    transientCollectible: Schema.String,
    commitment: Schema.String,
    permanentCollectible: Schema.String,
    ordinaryCollectible: Schema.String,
    pendingDiscovery: Schema.String,
    pendingDiscoveryPlural: Schema.String,
    discoveryDraw: Schema.String,
    discoveryDrawPlural: Schema.String,
    basketRelic: Schema.String,
    indicatorRelic: Schema.String,
    canonicalMarket: Schema.String,
    claimGate: Schema.String,
    rewardLedger: Schema.String,
    rewardEpoch: Schema.String,
    rewardTrack: Schema.String,
    deferredTrackBudget: Schema.String,
    sealedRoute: Schema.String,
    settlementAsset: Schema.String,
    conversionAsset: Schema.String,
    stockReward: Schema.String,
    pendingRewards: Schema.String,
    protocolOwnedLiquidity: Schema.String,
    genesisLiquidity: Schema.String,
    keeper: Schema.String,
    owner: Schema.String,
    guardian: Schema.String,
    recoveryAuthority: Schema.String,
    creator: Schema.String,
    liquidityExecutor: Schema.String,
  }),
  navigation: Schema.Struct({
    exchange: Schema.String,
    collection: Schema.String,
    collectionTask: Schema.String,
    commitment: Schema.String,
    rewards: Schema.String,
    basketRelics: Schema.String,
    indicatorRelic: Schema.String,
  }),
  assets: Schema.Struct({
    transient: Schema.String,
    permanent: Schema.String,
    basketRelic: Schema.String,
    indicatorRelic: Schema.String,
  }),
  applicationAssets: Schema.Struct({
    homeHero: Schema.String,
  }),
  disclosures: Schema.Struct({
    testnet: Schema.String,
    placeholderMetadata: Schema.String,
    commitment: Schema.String,
    stockRewardUnits: Schema.String,
  }),
  copy: Schema.Struct({
    homeIntroduction: Schema.String,
    applicationTagline: Schema.String,
    metadataDescription: Schema.String,
    protocolPending: Schema.String,
  }),
});

export type IdentityConfiguration = Schema.Schema.Type<
  typeof IdentityConfigurationSchema
>;
export type IdentityConfigurationKey = IdentityConfiguration["key"];

const decodeIdentityConfiguration = Schema.decodeUnknownSync(
  IdentityConfigurationSchema,
);

const orbitIdentityInput: unknown = {
  key: "orbit-4444",
  brand: "ORBIT 4444",
  liquidToken: {
    displayName: "$FUEL",
    name: "ORBIT Fuel",
    symbol: "FUEL",
  },
  collectibleToken: {
    name: "ORBIT 4444 Collectibles",
    symbol: "ORBIT",
  },
  rewardTrackLabels: ["All Reward Tracks", "AAPLc", "GOOGLc", "METAc", "NVDAc"],
  rarityTierLabels: ["Special", "I", "II", "III", "IV"],
  terms: {
    transientCollectible: "Grounded Craft",
    commitment: "Launch",
    permanentCollectible: "Orbiter",
    ordinaryCollectible: "Ordinary",
    pendingDiscovery: "Pending Discovery",
    pendingDiscoveryPlural: "Pending Discoveries",
    discoveryDraw: "Discovery",
    discoveryDrawPlural: "Discoveries",
    basketRelic: "Station",
    indicatorRelic: "Observatory",
    canonicalMarket: "Canonical Market",
    claimGate: "Claim Gate",
    rewardLedger: "Reward Ledger",
    rewardEpoch: "Reward Epoch",
    rewardTrack: "Reward Track",
    deferredTrackBudget: "Deferred Track Budget",
    sealedRoute: "Sealed Route",
    settlementAsset: "Settlement Asset",
    conversionAsset: "Conversion Asset",
    stockReward: "Stock Reward",
    pendingRewards: "Pending Rewards",
    protocolOwnedLiquidity: "Protocol-Owned Liquidity",
    genesisLiquidity: "Genesis Liquidity",
    keeper: "Keeper",
    owner: "Owner",
    guardian: "Guardian",
    recoveryAuthority: "Recovery Authority",
    creator: "Creator",
    liquidityExecutor: "Protocol-Owned Liquidity executor",
  },
  navigation: {
    exchange: "Exchange",
    /* A fleet, not a hangar. A hangar is where *aircraft* are kept, which was
       the one word pulling Stations and the Observatory -- both orbital -- down
       onto an airfield. And this destination is not a place: it lists all 4,444
       identities in every state, which is what a fleet is. */
    collection: "Fleet",
    collectionTask: "My Collection",
    commitment: "Launch",
    rewards: "Reward Stocks",
    basketRelics: "Stations",
    indicatorRelic: "Observatory",
  },
  assets: {
    transient: "placeholder://orbit-4444/grounded-craft",
    permanent: "placeholder://orbit-4444/orbiter",
    basketRelic: "placeholder://orbit-4444/station",
    indicatorRelic: "placeholder://orbit-4444/observatory",
  },
  applicationAssets: {
    homeHero: "/images/grounded-craft-hangar.png",
  },
  disclosures: {
    testnet: "Base Sepolia only. All assets are valueless test assets.",
    placeholderMetadata:
      "Placeholder metadata and artwork for the proof of concept; this is not final artwork or production metadata.",
    commitment:
      "Launch irreversibly burns one $FUEL and makes the selected Grounded Craft a permanent Orbiter.",
    stockRewardUnits:
      "Stock Reward amounts are raw token units, not guaranteed underlying-share counts.",
  },
  copy: {
    homeIntroduction:
      "Use no-value test assets to buy $FUEL. Every whole $FUEL reveals a random Grounded Craft; Launch later burns one $FUEL forever and makes it a permanent Orbiter.",
    applicationTagline: "Collect. Launch. Stay in orbit.",
    metadataDescription:
      "A placeholder ORBIT 4444 identity for the valueless Base Sepolia proof of concept.",
    protocolPending:
      "The sealed Base Sepolia deployment record is not published yet. These views switch to live protocol reads after the verified deployment is recorded.",
  },
};

const neutralTestIdentityInput: unknown = {
  key: "neutral-test",
  brand: "Base Collectible Rewards",
  liquidToken: {
    displayName: "Test Liquid Token",
    name: "Test Liquid Token",
    symbol: "TEST",
  },
  collectibleToken: {
    name: "Test Collectibles",
    symbol: "TCOL",
  },
  rewardTrackLabels: [
    "All Distribution Tracks",
    "Track One",
    "Track Two",
    "Track Three",
    "Track Four",
  ],
  rarityTierLabels: ["Unique", "Tier I", "Tier II", "Tier III", "Tier IV"],
  terms: {
    transientCollectible: "Transient Collectible",
    commitment: "Commit",
    permanentCollectible: "Permanent Collectible",
    ordinaryCollectible: "Standard Collectible",
    pendingDiscovery: "Pending Assignment",
    pendingDiscoveryPlural: "Pending Assignments",
    discoveryDraw: "Assignment",
    discoveryDrawPlural: "Assignments",
    basketRelic: "Basket Relic",
    indicatorRelic: "Indicator Relic",
    canonicalMarket: "Primary Market",
    claimGate: "Eligibility Gate",
    rewardLedger: "Distribution Ledger",
    rewardEpoch: "Distribution Round",
    rewardTrack: "Distribution Track",
    deferredTrackBudget: "Queued Track Budget",
    sealedRoute: "Conversion Route",
    settlementAsset: "Settlement Token",
    conversionAsset: "Conversion Token",
    stockReward: "Token Reward",
    pendingRewards: "Accrued Rewards",
    protocolOwnedLiquidity: "Treasury Liquidity",
    genesisLiquidity: "Initial Liquidity",
    keeper: "Operator",
    owner: "Administrator",
    guardian: "Safety Guardian",
    recoveryAuthority: "Recovery Administrator",
    creator: "Creator",
    liquidityExecutor: "Treasury Liquidity operator",
  },
  navigation: {
    exchange: "Exchange",
    collection: "Collectibles",
    collectionTask: "My Collectibles",
    commitment: "Commit",
    rewards: "Stock Rewards",
    basketRelics: "Basket Relics",
    indicatorRelic: "Indicator Relic",
  },
  assets: {
    transient: "placeholder://neutral-test/transient-collectible",
    permanent: "placeholder://neutral-test/permanent-collectible",
    basketRelic: "placeholder://neutral-test/basket-relic",
    indicatorRelic: "placeholder://neutral-test/indicator-relic",
  },
  applicationAssets: {
    homeHero: "/images/grounded-craft-hangar.png",
  },
  disclosures: {
    testnet: "Base Sepolia only. All assets are valueless test assets.",
    placeholderMetadata:
      "Placeholder metadata and artwork for the proof of concept; this is not final artwork or production metadata.",
    commitment:
      "Commit irreversibly burns one Test Liquid Token and makes the selected Transient Collectible permanent.",
    stockRewardUnits:
      "Test reward quantities are raw token units, not guaranteed underlying-share counts.",
  },
  copy: {
    homeIntroduction:
      "Use no-value test assets to buy the Test Liquid Token. Every whole token reveals a random Transient Collectible; Commit later burns one token forever and makes it permanent.",
    applicationTagline: "Collect. Commit. Become permanent.",
    metadataDescription:
      "A placeholder collectible identity for the valueless Base Sepolia proof of concept.",
    protocolPending:
      "The sealed Base Sepolia deployment record is not published yet. These views switch to live protocol reads after the verified deployment is recorded.",
  },
};

export const identityConfigurations = {
  "orbit-4444": decodeIdentityConfiguration(orbitIdentityInput),
  "neutral-test": decodeIdentityConfiguration(neutralTestIdentityInput),
} as const;

export const selectIdentityConfiguration = (key: IdentityConfigurationKey) =>
  identityConfigurations[key];

/**
 * Collector-facing application language is constructed from the selected
 * identity adapter so components never own product-specific vocabulary.
 */
/* Structural destination labels, shared by the shell and by the route titles
 * that name the same destination. Declared once so a route heading and its tab
 * can never disagree, as "Enter the Exchange" and "Trade" did. */
const destinations = {
  start: "Get started",
  faucet: "Faucet",
  exchange: "Trade",
  market: "Market",
  collection: "Collection",
  rewards: "Rewards",
  relics: "Relics",
  status: "Status",
  learn: "Learn",
  admin: "Admin",
} as const;

export const createIdentityApplicationCopy = (
  identity: IdentityConfiguration,
) =>
  ({
    shell: {
      skipToContent: "Skip to main content",
      home: "Protocol overview",
      navigation: "Primary navigation",
      accessibilityNavigation: "Accessibility navigation",
      connectWallet: "Connect wallet",
      connectingWallet: "Connecting",
      disconnectWallet: "Disconnect",
      signOut: "Sign out",
      switchNetwork: "Switch to Base Sepolia",
      connectedWallet: "Connected wallet",
      openMenu: "Open navigation",
      closeMenu: "Close navigation",
      collectorNavigation: "Collector navigation",
      collectGroup: "Collect",
      protocolNavigation: "Protocol navigation",
      collectorTasksGroup: "Tasks",
      protocolGroup: "Protocol",
      adminTasksGroup: "Console",
      adminExitGroup: "Leave console",
      adminNavigation: "Admin navigation",
      adminExitNavigation: "Leave admin navigation",
      operatorConsole: "Operator console",
      operationsNavigation: "Operations",
      diagnosticsNavigation: "Diagnostics",
      publicStatusNavigation: "Public protocol status",
      collectorAppNavigation: "Collector app",
      testnetDisclosure: identity.disclosures.testnet,
      testnetCompactDisclosure: "No-value test assets.",
      testnetLabel: "BASE SEPOLIA",
      chainLabel: "CHAIN 84532",
      deploymentPending: "Base Sepolia deployment pending",
      networkReady: "Base Sepolia connected",
    },
    /* Shell destinations are named as consistent nouns.
     *
     * The audited navigation mixed a verb ("Start collecting"), a possessive
     * ("My Collection"), and qualified nouns ("Market data", "Special
     * collectibles") across seven flat siblings, so nothing in the labelling
     * distinguished the three steps of the collecting loop from the public
     * evidence surfaces. Brand-specific wording still comes from the identity
     * adapter; these are the shell's structural labels. */
    /* The collection destination is the one structural label an identity gets
       to name -- ORBIT calls it the Fleet, the neutral adapter calls it
       Collectibles -- and the shell tab has to read it from the same place the
       route heading does, or they disagree exactly the way this map exists to
       prevent. Every other destination is structural and identity-independent. */
    navigation: { ...destinations, collection: identity.navigation.collection },
    faucet: {
      eyebrow: "BASE SEPOLIA TEST ASSETS",
      title: "Fund a test wallet",
      /* One line. The audited introduction ran to three and listed what the
       * faucet does not do before saying what it does. */
      lede: `Request bounded Base Sepolia gas and test WETH; this faucet never dispenses ${identity.liquidToken.displayName}.`,
      eligibilityLabel: "Eligibility",
      requestTitle: "Request",
      stateLabel: "State",
      gasLabel: "Gas ETH",
      wethLabel: "Test WETH",
      target: (amount: string) => `Target ${amount}`,
      remaining: (amount: string) => `${amount} remaining`,
      eligibleNow: "Now",
      eligibleUnknown: "After the wallet check",
      cooldownHint: (hours: string) => `${hours} h cooldown per wallet`,
      securityDisclosure: "How this faucet is secured",
      stateBadges: {
        disconnected: "Disconnected",
        "wrong-network": "Wrong network",
        "deployment-pending": "Pending",
        checking: "Checking",
        eligible: "Eligible",
        submitting: "Submitting",
        pending: "Pending",
        retryable: "Retry",
        funded: "Funded",
        "funded-not-retained": "Not retained",
        cooldown: "Cooldown",
        "lifetime-exhausted": "Limit reached",
        "inventory-empty": "Empty",
        disabled: "Disabled",
        busy: "Busy",
        confirming: "Confirming",
        "rpc-unavailable": "Unavailable",
        unavailable: "Unavailable",
      },
      introduction: `Request a bounded, inventory-backed top-up for Base Sepolia gas and test WETH. This faucet never dispenses ${identity.liquidToken.displayName}, mints collectibles, or runs protocol operations.`,
      assetBoundaryLabel: "What the faucet does and does not provide",
      assets: {
        gas: {
          title: "Base Sepolia ETH",
          badge: "Gas only",
          body: "Provided only for Base Sepolia transaction fees. It is not a trading asset in this application.",
        },
        weth: {
          title: "Test WETH",
          badge: "Faucet provided",
          body: `A bounded test settlement asset. Use it to buy ${identity.liquidToken.displayName} on Trade.`,
        },
        fuel: {
          title: identity.liquidToken.displayName,
          badge: "Not dispensed",
          body: `Buy it on Trade with test WETH. Crossing each whole-unit boundary schedules a random ${identity.terms.discoveryDraw}.`,
        },
        collectibles: {
          title: "Collectibles",
          badge: "Never minted by this faucet",
          body: `A ${identity.terms.transientCollectible} comes only from the protocol's ${identity.terms.discoveryDraw} path; an ${identity.terms.permanentCollectible} comes only from irreversible ${identity.terms.commitment}.`,
        },
      },
      requestEyebrow: "YOUR WALLET",
      currentBalance: "Current",
      remainingTopUp: "Top-up remaining",
      nextEligible: "Eligible again",
      states: {
        disconnected: {
          title: "Connect a wallet to check eligibility",
          body: "The faucet checks only the connected public address. No wallet secret is requested or exposed.",
        },
        "wrong-network": {
          title: "Switch to Base Sepolia",
          body: "Top-ups are available only for the selected Base Sepolia deployment.",
        },
        "deployment-pending": {
          title: "Deployment record is pending",
          body: "Funding stays unavailable until the selected deployment is published.",
        },
        checking: {
          title: "Checking this wallet",
          body: "Reading public balances, limits, and faucet inventory.",
        },
        eligible: {
          title: "Wallet is eligible",
          body: "You receive only the amount needed to reach the gas and test WETH targets.",
        },
        submitting: {
          title: "Requesting the top-up",
          body: "Keep this page open while the transfers are prepared.",
        },
        pending: {
          title: "Top-up transactions are pending",
          body: "At least one transfer was submitted; a safe retry resumes the same request.",
        },
        retryable: {
          title: "Top-up needs a safe retry",
          body: "The previous request did not complete; retrying resumes it without sending twice.",
        },
        funded: {
          title: "Wallet funded for the test journey",
          body: `Gas ETH and test WETH targets are met; the next step is buying ${identity.liquidToken.displayName} on Trade.`,
        },
        "funded-not-retained": {
          title: "Top-up confirmed, but this wallet did not keep it",
          body: "Every transfer confirmed and the allowance was spent, yet this wallet is still below the targets; use a wallet that holds what it receives.",
        },
        cooldown: {
          title: "Wallet is in cooldown",
          body: "Each wallet waits between top-ups; check again after the time shown.",
        },
        "lifetime-exhausted": {
          title: "Wallet reached its top-up limit",
          body: "This address has used its lifetime allowance, so the faucet will not send more.",
        },
        "inventory-empty": {
          title: "Faucet inventory is empty",
          body: "The faucet has nothing left to send right now; no balance is inferred or created.",
        },
        disabled: {
          title: "Faucet is disabled",
          body: "Self-service funding is switched off for now; trading and the protocol are unaffected.",
        },
        busy: {
          title: "The faucet is finishing another top-up",
          body: "It serves one wallet at a time; retrying in a moment queues this wallet.",
        },
        confirming: {
          title: "Waiting for the transfers to settle",
          body: "The transfers confirmed and the balance read has not caught up yet; checking again submits nothing new.",
        },
        "rpc-unavailable": {
          title: "Base Sepolia balance check unavailable",
          body: "Balances could not be verified safely, so nothing was sent; checking again is safe.",
        },
        unavailable: {
          title: "Faucet temporarily unavailable",
          body: "The funding service did not return reliable state; checking again is safe and sends nothing.",
        },
      },
      actions: {
        fund: "Top up this wallet",
        retryStatus: "Check again",
        retryFunding: "Retry top-up",
        trade: `Buy ${identity.liquidToken.displayName} on Trade`,
      },
      inventoryDisclosure:
        "Top-ups come from a pre-funded inventory and stop at fixed per-wallet targets. Requesting one signs a message that proves you control this address; no secret leaves your wallet, and nothing on this page can move protocol funds.",
      inventoryEvidence:
        "Technical detail: the funding service holds its own signer and runs outside the browser; this site only reads its public status and submits a signed request.",
    },
    onboarding: {
      eyebrow: "BASE SEPOLIA COLLECTOR JOURNEY",
      title: `Get your first ${identity.terms.permanentCollectible}`,
      introduction: `Three phases take a test wallet from bounded test assets to a random ${identity.terms.transientCollectible}, then an optional irreversible ${identity.terms.commitment} creates its first permanent ${identity.terms.permanentCollectible}.`,
      /* One line. The three-step explanation this route used to open with now
       * lives on the home page, where it belongs; what is unique here is the
       * live position in the journey and the single next action. */
      lede: `Where this wallet is in the journey, and the one action to take next.`,
      phases: {
        fund: {
          title: "Fund",
          current: `Get gas ETH and test WETH from Faucet, then buy ${identity.liquidToken.displayName} on Trade.`,
          trade: `Buy enough ${identity.liquidToken.displayName} to cross the next whole-unit boundary; that Trade triggers a random ${identity.terms.discoveryDraw}.`,
          complete: `Test assets and the ${identity.liquidToken.displayName} boundary needed for ${identity.terms.discoveryDraw} are complete.`,
        },
        discover: {
          title: "Discover",
          current: `${identity.terms.discoveryDraw} is awaiting verified randomness; check ${identity.navigation.collectionTask} for the assigned ${identity.terms.transientCollectible}.`,
          complete: `A ${identity.terms.transientCollectible} was assigned to this wallet.`,
        },
        launch: {
          title: identity.terms.commitment,
          current: `Choose the discovered ${identity.terms.transientCollectible} only if you want to make it a permanent ${identity.terms.permanentCollectible}.`,
          complete: `A permanent ${identity.terms.permanentCollectible} is held by this wallet.`,
        },
      },
      access: {
        disconnected: "Connect a wallet to begin.",
        "wrong-network": "Switch to Base Sepolia before continuing.",
        "deployment-pending": identity.copy.protocolPending,
      },
      waiting: "Available after the previous phase.",
      complete: "Complete",
      current: "Current",
      waitingLabel: "Waiting",
      phase: "Phase",
      phaseOf: (index: number, total: number) => `${index} of ${total}`,
      journeyDone: "Done",
      actions: {
        faucet: "Open Faucet",
        trade: `Buy ${identity.liquidToken.displayName} on Trade`,
        collection: `Check ${identity.terms.discoveryDraw} in ${identity.navigation.collectionTask}`,
        launch: (identityId: number) =>
          `Review ${identity.terms.commitment} · ${identity.terms.transientCollectible} #${identityId}`,
      },
      launchWarning: `Burns exactly one ${identity.liquidToken.displayName} forever and makes the selected ${identity.terms.transientCollectible} a permanent ${identity.terms.permanentCollectible}.`,
      launchWarningLabel: "Irreversible",
      discoveryDisclosure: `On Base Sepolia, each whole-unit ${identity.terms.discoveryDraw} requests a verifiable random draw from Chainlink VRF after the acquisition is confirmed. The wallet cannot preview the identity: a ${identity.terms.pendingDiscovery} appears first, and the ${identity.terms.transientCollectible} is assigned only in the independently verified callback.`,
      lossDisclosure: `Selling a whole ${identity.liquidToken.displayName} first cancels the latest ${identity.terms.pendingDiscovery}, then dissolves the latest ${identity.terms.transientCollectible}. Transferring liquid tokens has the same whole-unit boundary effect. Permanent ${identity.terms.permanentCollectible}s are not dissolved.`,
      details: `How ${identity.terms.discoveryDraw} and whole-token boundaries work`,
      nextStepEyebrow: "YOUR NEXT STEP",
      nextStepLabel: "Current step",
      progressEyebrow: "LIVE WALLET PROGRESS",
      progressLabel: "Live collector progress",
      balance: `${identity.liquidToken.displayName} balance`,
      nextThreshold: `Next ${identity.terms.discoveryDraw} threshold (${identity.liquidToken.displayName})`,
      remaining: `${identity.liquidToken.displayName} still needed`,
      collectionProgress: "Collection progress",
      noCraft: `No ${identity.terms.transientCollectible} yet`,
      pending: `1 ${identity.terms.pendingDiscovery}`,
      transientCount: (count: number) =>
        `${count} ${identity.terms.transientCollectible}${count === 1 ? "" : "s"}`,
      permanentCount: (count: number) =>
        `${count} ${identity.terms.permanentCollectible}${count === 1 ? "" : "s"}`,
      progressUnavailable:
        "Live wallet progress appears after a successful Base Sepolia read.",
      progressLoadingTitle: "Reading live wallet progress",
      progressLoadingBody:
        "Balances and collection progress appear when the Base Sepolia read completes.",
      progressUnavailableTitle: "Live wallet progress unavailable",
      walletActionInHeader:
        "Use the wallet control in the header to continue; its status is shown there.",
      journeyCompleteTitle: (identityId: number) =>
        `${identity.terms.permanentCollectible} #${identityId} is permanent`,
      journeyCompleteBody: `Funding, ${identity.terms.discoveryDraw}, and ${identity.terms.commitment} are complete; a permanent ${identity.terms.permanentCollectible} is never dissolved by later ${identity.liquidToken.displayName} balance changes.`,
      journeyCompleteAction: (identityId: number) =>
        `Open ${identity.terms.permanentCollectible} #${identityId}`,
      completedJourneyDetails: "Review completed phases",
    },
    publicStatus: {
      eyebrow: "PUBLIC ONCHAIN HEALTH",
      title: "Protocol status",
      introduction: `A point-in-time Base Sepolia read of collection counts, destination-locked funds, and recent ${identity.terms.rewardEpoch} activity, with no wallet required.`,
      healthExplanation: {
        healthy:
          "Every bounded check passed in this point-in-time onchain read.",
        degraded:
          "At least one public check is incomplete, stale, or needs attention.",
        critical: "A critical invariant failed in this point-in-time read.",
      },
      freshness: {
        fresh: "Fresh snapshot",
        stale: "Stale snapshot",
        unknown: "Freshness unavailable",
      },
      snapshotEvidence: (network: string, block: string) =>
        `${network} · block ${block}`,
      snapshotDisclosure:
        "This is a point-in-time read, not continuous monitoring or proof that an offchain worker is running.",
      healthLabel: "Onchain health",
      networkLabel: "Network",
      launchBlockLabel: "Launch block",
      launchBlockUnpublished: "Not published",
      collectionSize: "Collection size",
      deploymentEvidenceHeading: "Base Sepolia deployment evidence",
      deploymentEvidenceNote:
        "Facts from the sealed manifest stay available while the live read completes.",
      deploymentUnavailableTitle: "Deployment snapshot unavailable",
      unavailableTitle: "Public snapshot unavailable",
      timedOutTitle: "Public read timed out",
      timedOutDescription:
        "The public onchain read reached its 8-second safety limit; no known snapshot was replaced.",
      lastKnownTitle: "Showing last-known public snapshot",
      lastKnownDescription:
        "The latest refresh failed; the evidence below is the last successful public snapshot and keeps its original observation time.",
      refreshingTitle: "Refreshing live evidence",
      refreshingDescription:
        "Showing the saved public snapshot while a newer onchain read completes.",
      collectionHeading: "Collection state",
      collectionIntroduction:
        "Each identity is available, temporarily assigned, permanently committed, or pending discovery.",
      rewardActivityHeading: {
        complete: "Latest indexed reward activity",
        partial: "Partial indexed reward history",
        unknown: "Reward history unavailable",
      },
      latestRewardIntroduction: `WETH enters a ${identity.terms.rewardEpoch}; each completed route buys one mock stock token for collector rewards.`,
      epochCountLabel: `${identity.terms.rewardEpoch}s`,
      historyCoverage: {
        complete:
          "The reward index reconciles from launch through this observed block.",
        partial:
          "This indexed window is incomplete, so the events shown are evidence from that window rather than the latest or full protocol history.",
        unknown:
          "Reward event coverage is unavailable, so point-in-time balances are not presented as conversion history.",
      },
      openingFeedback: {
        complete: "No indexed reward opening",
        partial: "Indexed reward opening is incomplete",
        unknown: "Indexed reward opening is unavailable",
      },
      conversionFeedback: {
        complete: "No indexed conversions",
        partial: "Indexed conversion history is incomplete",
        unknown: "Indexed conversion history is unavailable",
      },
      historyFeedback: {
        complete: "No indexed reward events",
        partial: "Indexed reward history is incomplete",
        unknown: "Indexed reward history is unavailable",
      },
      indexedOpeningLabel: {
        complete: "Latest indexed opening",
        partial: "Most recent opening in the partial index",
        unknown: "Reward opening history unavailable",
      },
      recentConversionsLabel: {
        complete: "Latest indexed stock conversions",
        partial: "Stock conversions present in the partial index",
        unknown: "Stock conversion history unavailable",
      },
      noConversionsIndexed:
        "No stock conversion event is present in the available reward index.",
      wethEnteredAtOpening: (amount: string) => `${amount} entered at opening`,
      stockReservedForClaims: (amount: string, track: string) =>
        `${amount} ${track} reserved for collector claims`,
      conversionAttributionBoundary: `Conversion events do not carry an epoch ID and a ${identity.terms.rewardTrack} queue can span several openings, so openings and conversions are listed separately and never attributed to one another.`,
      latestRewardUnavailable: `No ${identity.terms.rewardEpoch} opening is present in the available reward index.`,
      rewardHistoryDisclosure: {
        complete: "View complete indexed reward event history",
        partial: "View partial indexed reward event history",
        unknown: "Reward event history unavailable",
      },
      rewardOpeningTitle: (epoch: string) =>
        `${identity.terms.rewardEpoch} ${epoch} opened`,
      rewardConversionTitle: (track: string) => `${track} conversion`,
      rewardClaimTitle: (track: string) => `${track} collector claim`,
      rewardConversionDetail: (
        spent: string,
        received: string,
        remaining: string,
      ) =>
        `${spent} converted into ${received} stock tokens; ${remaining} remains in this track queue.`,
      rewardClaimDetail: (amount: string, identityId: number) =>
        `${amount} stock tokens were claimed for identity #${identityId}.`,
      rewardEventBlock: (block: string) => `Observed at block ${block}`,
      workerBoundary: `Reward automation is a separate operator process, so this onchain snapshot shows completed work but cannot prove that the ${identity.terms.keeper} is currently running.`,
      evidenceDisclosure: "Reward index evidence and methodology",
      evidenceDisclosureNote:
        "Exact epoch openings, conversion attribution, transaction receipts, and index-coverage methodology are public onchain data, grouped here so the health answer above stays direct.",
      evidenceHeading: "Indexed reward events",
      marketLink: "View market and liquidity",
      rewardsLink: "Open collector rewards",
      observedAt: "Observed at",
      observedBlock: "Observed block",
      expectedDeployment: "Selected deployment manifest",
      observedDeployment: "Observed onchain state",
      deploymentChecks: "Deployment and seal checks",
      checksHeading: "Public health checks",
      accountingChecks: "Accounting reconciliation",
      marketChecks: "Market and routing checks",
      operationsChecks: "Operational state checks",
      collectionSnapshot: "Collection snapshot",
      rewardAccounting: `${identity.terms.rewardLedger} accounting`,
      rewardQueues: `${identity.terms.rewardTrack} WETH queues`,
      fundsHeading: "Destination-locked funds",
      fundsIntroduction:
        "Current destination-locked balances are separated from cumulative WETH already consumed by permanent liquidity positions.",
      rewardsWaiting: "Rewards waiting",
      rewardsWaitingDescription: `WETH waiting in the hook or a ${identity.terms.rewardTrack} queue before stock conversion.`,
      liquidityWaiting: `${identity.terms.protocolOwnedLiquidity} waiting`,
      liquidityWaitingDescription:
        "Current WETH still held for a future liquidity cycle.",
      liquidityCommitted: "Cumulative WETH committed",
      liquidityCommittedDescription:
        "Historical WETH consumed by permanently locked liquidity positions; this is not a current withdrawable balance.",
      creatorFees: "Creator fees awaiting claim",
      creatorFeesDescription:
        "Creator fees remain separate from reward and liquidity funds.",
      generalTreasury: "General-purpose treasury",
      noTreasury: "None",
      noTreasuryMeta: "No treasury",
      noTreasuryDescription:
        "There is no wallet or contract that can withdraw protocol funds for arbitrary spending.",
      fundSeparationDisclosure:
        "No general-purpose treasury exists in this deployment; reward, liquidity, and creator balances are separate destination-locked funds.",
      stockTokenUnits: "stock tokens",
      viewTransaction: "View transaction",
      activeWeight: "Active weight",
      liability: "Liability (raw token units)",
      tokenBalance: "Ledger balance (raw token units)",
      unclaimedPot: `Unclaimed ${identity.terms.rewardTrack} Pot (raw token units)`,
      basketPot: `${identity.terms.basketRelic} pot (raw token units)`,
      indicatorPot: `${identity.terms.indicatorRelic} pot (raw token units)`,
      protocolLiquidity: identity.terms.protocolOwnedLiquidity,
      queuedWeth: "Queued WETH",
      permanentlyLockedWeth: "Permanently locked WETH",
      liquidityCycles: "Completed liquidity cycles",
      recentEvents: "Bounded event recorder",
      eventSummary: "Last observed outcomes",
      noEvents:
        "No bounded operational events were observed in this deployment window.",
      readPending: "Reading the latest point-in-time Base Sepolia snapshot.",
      readUnavailable:
        "The public onchain snapshot is unavailable. No healthy state is inferred.",
      retryPublicStatus: "Retry public status",
      deploymentPending:
        "A complete selected deployment manifest is not available yet. Contract health cannot be inferred.",
      snapshotOnly:
        "This is a bounded onchain snapshot, not continuous monitoring or a production-readiness claim.",
      expected: "Expected",
      observed: "Observed",
      events: {
        "reward-epoch": identity.terms.rewardEpoch,
        "track-execution": `${identity.terms.rewardTrack} execution`,
        "track-execution-unknown": `${identity.terms.rewardTrack} attempt`,
        conversion: identity.terms.sealedRoute,
        retry: `${identity.terms.deferredTrackBudget} retry`,
        claim: `${identity.terms.stockReward} claim`,
        "pol-execution": identity.terms.protocolOwnedLiquidity,
      },
      success: "Successful",
      failure: "Failed",
      notObserved: "Not observed",
    },
    home: {
      eyebrow: `BASE SEPOLIA / ${identity.brand.toUpperCase()}`,
      title: identity.copy.applicationTagline,
      introduction: identity.copy.homeIntroduction,
      primaryAction: "Start collecting",
      secondaryAction: `Trade ${identity.liquidToken.displayName}`,
      heroAlt: `${identity.terms.transientCollectible} resting inside an orbital maintenance bay at sunrise`,
      heroAsset: identity.applicationAssets.homeHero,
      protocolStatus: "Public protocol status",
      launchedCount: `${identity.terms.permanentCollectible} count`,
      groundedCount: `${identity.terms.transientCollectible} count`,
      availableCount: "Available identities",
      health: "Protocol health",
      launchState: "Protocol launch",
      launched: "Launched",
      notLaunched: "Not launched",
      observedBlock: "Observed block",
      /* The three steps, stated once on the home page.
       *
       * The audited home page opened with a hero and then jumped straight to
       * protocol telemetry, so how the product actually works was only
       * explained on a separate onboarding tab whose content also duplicated
       * the collection surface. */
      stepsTitle: "How collecting works",
      stepsDescription: `Three steps take a test wallet from bounded test assets to a permanent ${identity.terms.permanentCollectible} that bears a ${identity.terms.stockReward}.`,
      steps: [
        {
          title: "Fund",
          body: `Take bounded gas ETH and test WETH from the faucet, then buy ${identity.liquidToken.displayName}.`,
        },
        {
          title: "Discover",
          body: `Crossing a whole ${identity.liquidToken.displayName} triggers one ${identity.terms.discoveryDraw}. The identity is drawn for you and cannot be chosen.`,
        },
        {
          title: identity.terms.commitment,
          body: `Optionally surrender that whole unit forever to make the ${identity.terms.transientCollectible} permanent and reward-eligible.`,
        },
      ],
      specimenLabel: "Every craft is drawn from its own identity number",
      specimenGrounded: `${identity.terms.transientCollectible} · backed by one whole ${identity.liquidToken.displayName}`,
      specimenLaunched: `${identity.terms.permanentCollectible} · ${identity.terms.commitment} burned that ${identity.liquidToken.displayName} forever`,
      census: "The census",
      censusNote: `4,444 identities. One whole ${identity.liquidToken.displayName} backs one ${identity.terms.transientCollectible}; ${identity.terms.commitment} makes it an ${identity.terms.permanentCollectible}.`,
      pendingCount: `${identity.terms.pendingDiscoveryPlural}`,
      collectionSize: "Collection size",
      network: "Network",
      liveCounts: "Live collection counts",
      price: `WETH per ${identity.liquidToken.displayName}`,
      rewardWaiting: "Reward WETH waiting",
      feeRouting: "Where the 3% fee goes",
      feeRoutingNote:
        "Every market swap charges 3% on its WETH side. The three destinations are fixed by the deployed protocol.",
      feeRewards: `${identity.terms.stockReward} conversion`,
      feeLiquidity: identity.terms.protocolOwnedLiquidity,
      feeCreator: "Creator",
      feeLocked: "Locked forever",
      rewardTracks: "Reward tracks",
      rewardTracksNote: `Each ${identity.terms.permanentCollectible} belongs to one track and earns that tokenized stock from converted fees.`,
      rewardTrackLiability: "Owed to holders",
      retryStatus: "Retry public status",
      operationsLink: "Inspect full public protocol status",
      operationsNote:
        "Public health stays concise here. Exact expected and observed evidence lives in the dedicated status view.",
    },
    exchange: {
      eyebrow: identity.terms.canonicalMarket,
      title: destinations.exchange,
      introduction: `Buy and sell ${identity.liquidToken.displayName} for ETH or WETH on the ${identity.terms.canonicalMarket} with a live balance-checked quote.`,
      pay: "You pay",
      receive: "You receive",
      nativeEth: "ETH",
      wrappedEth: "WETH",
      token: identity.liquidToken.displayName,
      payUsing: "Pay using",
      receiveAs: "Receive as",
      walletTitle: "Wallet",
      marketTitle: "Market",
      balances: "Wallet balances",
      balancesPaying: "Paying",
      balancesObserved: (block: string) => `Read at block ${block}`,
      /* The block number is typeset by the value primitives, so the label and
       * the number are separate rather than interpolated into one string. */
      balancesObservedLabel: "Read at block",
      balancesObservedUnknown: "No wallet read yet",
      refreshBalances: "Refresh balances",
      refreshingBalances: "Refreshing balances…",
      quote: "Quoted output",
      lede: `Buy and sell ${identity.liquidToken.displayName} for ETH or WETH with a live balance-checked quote.`,
      orderTitle: "Order",
      discoveryRule: `Each whole ${identity.liquidToken.displayName} crossed schedules one ${identity.terms.discoveryDraw}.`,
      fee: "Trading fee",
      defaultFee: "3.00%",
      price: `WETH per ${identity.liquidToken.displayName}`,
      rewardsWaiting: "Reward WETH waiting",
      liquidityTotal: `${identity.terms.protocolOwnedLiquidity} total`,
      creatorWaiting: "Creator fees waiting",
      directionToToken: `Buy ${identity.liquidToken.displayName}`,
      directionToWeth: `Sell ${identity.liquidToken.displayName}`,
      refreshQuote: "Retry quote",
      submitBuy: `Buy ${identity.liquidToken.displayName}`,
      submitSell: `Sell ${identity.liquidToken.displayName}`,
      submittingBuy: `Buying ${identity.liquidToken.displayName}…`,
      submittingSell: `Selling ${identity.liquidToken.displayName}…`,
      maxAmount: "Max",
      maxAmountLabel: (asset: string) =>
        asset === "ETH"
          ? "Use the available ETH balance while reserving gas"
          : `Use the full ${asset} balance`,
      termsTitle: "Trade terms",
      executionPrice: "Execution price",
      priceImpact: "Price impact",
      minimumReceived: "Minimum received",
      quoteBlock: "Quoted at block",
      quoteFreshness: "Quote freshness",
      quoteFresh: "Current",
      quoteAge: (seconds: number) => `${seconds}s old`,
      reviewPay: "Pay",
      reviewReceive: "Receive",
      slippageTolerance: "Slippage tolerance",
      deadlineLabel: "Must confirm within",
      slippagePolicy: (tolerance: string, deadline: string) =>
        `Every trade is submitted with a fixed ${tolerance} slippage tolerance and must confirm within ${deadline}. If the price moves past that tolerance the swap reverts instead of filling at a worse rate, and your assets stay in the wallet. This policy is not adjustable in this application.`,
      awaitingQuote: "No quote yet",
      insufficientBalance: (asset: string) => `Not enough ${asset}.`,
      availableMaximum: (amount: string, asset: string) =>
        `Enter ${amount} ${asset} or less.`,
      faucetRecovery: "Get test WETH",
      nativeFaucetRecovery: "Get Base Sepolia ETH",
      buyRecovery: `Buy ${identity.liquidToken.displayName} first`,
      invalidAmount: "Enter a positive decimal with up to 18 places.",
      readerUnavailable: `The live ${identity.terms.canonicalMarket} reader is unavailable.`,
      balanceUnavailable:
        "Wallet balance unavailable — retry the wallet read before trading.",
      balanceLoading: "Reading the wallet balance…",
      reviewTitle: "Review trade",
      quoteUnavailable: "Live quote unavailable — retry the quote.",
      staleQuote: "Quote stale — retry before submitting.",
      quoteReviewChanged:
        "The live quote or collection impact changed. Review the refreshed trade details, then submit again.",
      discoveryEvidenceUnavailable:
        "Wallet discovery boundary unchecked — retry the quote before submitting.",
      discoveryEvidenceInvalid:
        "This quote belongs to a different wallet or boundary state — request a new quote.",
      discoveryLimit: (
        mutations: number,
        maximum: number,
        maximumAmount: string,
      ) =>
        `This trade crosses ${mutations} whole-unit discovery boundaries, above the ${maximum} one transfer allows — trade at most ${maximumAmount} ${identity.liquidToken.displayName} per swap.`,
      quoteLoading: "Getting a current quote…",
      quotePending: "Quoting…",
      quoteEmpty: "Enter an amount to get an automatic live quote.",
      unavailable: `The live ${identity.terms.canonicalMarket} reader is unavailable for this deployment.`,
      amountPlaceholder: "0.00",
      poolEyebrow: "PUBLIC MARKET TELEMETRY",
      poolDashboard: `${identity.terms.canonicalMarket} dashboard`,
      poolIntroduction: `Inspect the pinned Uniswap v4 pool, fee queues, and cumulative ${identity.terms.protocolOwnedLiquidity} directly from Base Sepolia.`,
      openingCurveTitle: "How the opening price was set",
      openingCurveExplanation: `The pool opened on a POC reference curve near 0.005743 WETH per ${identity.liquidToken.displayName}. That benchmark was the first marginal price, not the current market price. The live price above moves with swaps; each trade has its own average execution price plus the 3% WETH-side fee. The benchmark is not treasury value, deposited WETH, or a return estimate.`,
      inspectPoolManager: "Inspect PoolManager on BaseScan",
      activeLiquidity: "Active in-range liquidity",
      activeLiquidityUnits: "Raw Uniswap liquidity units",
      totalFeeQueue: "Current fee queues",
      feeRouting: "Where the 3% fee is now",
      rewardFee: "Reward WETH waiting",
      liquidityFee: `${identity.terms.protocolOwnedLiquidity} WETH waiting`,
      creatorFee: "Creator fees awaiting claim",
      feeQueueDisclosure:
        "Waiting balances include both the hook and downstream contract queues. They are destination-locked protocol funds, not pool TVL or an estimate of investment returns.",
      poolIdentity: "Canonical pool identity",
      poolIdentitySummary: "Show technical pool identity",
      poolId: "Pool ID",
      poolIndexingDisclosure:
        "DEX Screener does not index this custom Base Sepolia v4 pool. BaseScan exposes the shared PoolManager contract; the Pool ID above identifies this exact pool.",
      /* Chart states. A chart of nothing is not a chart, and a two-point line
       * is not a trend; both used to render as full-height plots. */
      historyTooShort: "Not enough indexed history",
      poolGrowthEmpty: `No ${identity.terms.protocolOwnedLiquidity} cycle has completed yet, so there is nothing to plot.`,
      candleSparse:
        "This range holds too few candles to read as a price trend. The observations themselves are shown.",
      poolGrowthSparse:
        "Too few completed cycles to read as growth. The completed cycles themselves are shown.",
      poolGrowth: `${identity.terms.protocolOwnedLiquidity} growth`,
      poolGrowthIntroduction:
        "Solid points are completed WETH-only liquidity cycles. The dashed final point includes WETH already queued for a future cycle.",
      poolGrowthDescription:
        "Cumulative permanently locked WETH by completed liquidity cycle, followed by a projected point for funds currently queued.",
      poolGrowthWaiting:
        "A trend appears after enough completed or queued liquidity observations exist.",
      poolGrowthData: "Show exact chart data",
      poolGrowthStage: "Stage",
      poolGrowthTime: "Block time (UTC)",
      poolGrowthBlock: "Block",
      poolGrowthLocked: "Locked or queued total",
      poolGrowthConsumed: "Consumed WETH",
      poolGrowthQueue: "Queue after cycle",
      poolGrowthRange: "Tick range",
      poolGrowthLiquidity: "Liquidity units",
      poolGrowthStart: "Start",
      poolGrowthQueued: "Locked + pipeline",
      poolGrowthPoints: "observations",
      rangeLabel: "Chart range",
      range24h: "24H",
      range7d: "7D",
      range30d: "30D",
      rangeAll: "All",
      rangeSummary: (range: string, count: number) =>
        `Showing ${count} traded interval${count === 1 ? "" : "s"} for the ${range} range.`,
      continuousRangeSummary: (
        range: string,
        candles: number,
        interval: string,
        traded: number,
      ) =>
        `Showing ${candles} continuous ${interval} candle${candles === 1 ? "" : "s"} for the ${range} range; ${traded} contain${traded === 1 ? "s" : ""} swaps.`,
      latestTrade: (at: string) => `Latest trade ${at}.`,
      chartSummary: (count: number, low: string, high: string, close: string) =>
        `${count} traded intervals. Low ${low}, high ${high}, latest close ${close}.`,
      candleChart: `${identity.liquidToken.displayName} market history`,
      candleIntroduction: `WETH per ${identity.liquidToken.displayName} prices from canonical Uniswap v4 swaps. No-trade candles carry the last close with zero volume. Volume on traded candles is gross trader WETH matched to this hook's FeeAccrued event.`,
      candleDescription: `Open, high, low, and close WETH per ${identity.liquidToken.displayName}, with gross trader WETH volume and exact indexed data on demand.`,
      advancedChartOpen: "Open advanced chart",
      advancedChartClose: "Close advanced chart",
      advancedChartDescription:
        "Drawing tools, indicators, layouts, and detailed chart settings.",
      candleInterval: (interval: "1m" | "1h") =>
        interval === "1m" ? "1 minute" : "1 hour",
      candleSourceUniswap: "Uniswap v4 OHLC",
      candleSourceIndexed: "Uniswap v4 PoolManager events",
      candleData: (interval: "1m" | "1h") =>
        `Show exact traded ${interval === "1m" ? "minute" : "hourly"} OHLCV data`,
      candleTime: (interval: "1m" | "1h", timeZone: string) =>
        `${interval === "1m" ? "Minute" : "Hour"} (${timeZone})`,
      candleOpen: "Open",
      candleHigh: "High",
      candleLow: "Low",
      candleClose: "Close",
      candleVolume: "Gross trader WETH volume",
      candleVolumeShort: "Volume",
      candleProtocolFee: "Hook protocol fee",
      candleSwaps: "Swaps",
      candleTrades: (count: number) =>
        `${count} swap${count === 1 ? "" : "s"} in this candle`,
      candleCarried: "No swaps · carried close",
      candleNoSwaps: "No swaps in this candle; price carried from prior close",
      candleEmpty: "No indexed swaps yet",
      candleEmptyDetail:
        "The canonical pool has no swap observations in the indexed range.",
      candleVolumePartial:
        "Some swaps could not be matched to a FeeAccrued log, so volume and protocol-fee totals are partial.",
      candleLegend: "Candlestick legend",
      candleUp: "Close at or above open",
      candleDown: "Close below open",
      historyLoading: "Loading indexed market history",
      historyLoadingDetail:
        "Reading complete liquidity cycles, swaps, and hook fees from the local history index.",
      historyUnavailable: "Indexed market history is unavailable",
      historyUnavailableDetail:
        "Start or repair the history worker, then retry this read. Live market balances above remain separate.",
      historyStale: "History refresh failed",
      historyStaleDetail:
        "Showing the last confirmed indexed history while the latest refresh is unavailable. Retry before treating it as current.",
      historyRetry: "Retry indexed history",
      historyComplete: "Complete history",
      historyPartial: "Partial history",
      historyThrough: (block: string) => `Indexed through block ${block}`,
      historyThroughTime: "Indexed-through time",
      historyHead: "Observed chain head",
      historyLag: "Index lag",
      historyLagUnit: "blocks",
    },
    market: {
      /* One line. The audited lede ran to three and duplicated what the
       * metric strip beneath it already states. */
      lede: `Indexed history and fee routing for the ${identity.terms.canonicalMarket}.`,
      eyebrow: `PUBLIC ${identity.terms.canonicalMarket.toUpperCase()}`,
      title: "Market activity and liquidity",
      introduction: `Track the pinned ${identity.terms.canonicalMarket}, fee routing, ${identity.terms.protocolOwnedLiquidity} growth, and complete indexed trading history.`,
      /* Metric strip labels. The chart panel repeats none of them. */
      latestTrade: "Latest indexed trade",
      rangeVolume: "Available-range volume",
      indexedThrough: "Indexed through",
      livePriceHint: "Live pool read",
      indexedPriceHint: "Latest indexed close",
      lockedRow: `${identity.terms.protocolOwnedLiquidity} WETH permanently locked`,
      lockedShare: "Locked",
      noLiveBalances:
        "Live fee balances are not available yet. The fixed 3% routing split is unchanged.",
      historyReady: "Indexed market history is ready for the chart.",
      rawUnits: "Inspect raw integer units",
      copyRaw: "Copy raw candle data",
      copiedRaw: "Copied raw candle data",
      observationsLabel: (interval: string) =>
        `${interval} market observations`,
    },
    fleet: {
      eyebrow: "CONNECTED COLLECTION",
      title: identity.navigation.collection,
      introduction: `Inspect every ${identity.terms.transientCollectible} and ${identity.terms.permanentCollectible} held by the connected wallet.`,
      tokenBalance: `${identity.liquidToken.displayName} balance`,
      nextThreshold: `Next ${identity.terms.discoveryDraw} threshold`,
      remaining: `${identity.liquidToken.displayName} still needed`,
      grounded: identity.terms.transientCollectible,
      permanent: identity.terms.permanentCollectible,
      pending: identity.terms.pendingDiscovery,
      empty: `No ${identity.collectibleToken.name} are held by this wallet yet.`,
      emptyFaucetAction: "Fund the wallet on Faucet",
      emptyFilter: (label: string) =>
        `This wallet holds no ${label} yet. The other filters still show the rest of the collection.`,
      connect: `Connect a wallet to load your ${identity.navigation.collection}.`,
      connectAction: "Start collecting",
      filterLabel: "Filter collection",
      filterAll: "All",
      summaryLabel: "Collection summary",
      /* The disconnected route shows what the collection is — its public
       * model — rather than six unreadable metrics. */
      modelLabel: "Collection model",
      modelIdentities: "Identities",
      modelTracks: `${identity.terms.rewardTrack}s`,
      modelRelics: "Special identities",
      modelRelicsHint: `Three ${identity.terms.basketRelic}s and one ${identity.terms.indicatorRelic}`,
      modelWeights: "Tier weights I–IV",
      modelWeightsHint: "Reward weight by Rarity Tier",
      sampleTitle: "What a collector holds",
      sampleTransient: `Revealed at random when a wallet receives a whole ${identity.liquidToken.displayName}.`,
      samplePermanent: `Made permanent by ${identity.terms.commitment}; carries ${identity.terms.stockReward} units.`,
      sampleRelic:
        "One of four special identities reserved in the collection manifest.",
      emptyAction: `Buy ${identity.liquidToken.displayName} to trigger a ${identity.terms.discoveryDraw}`,
      inspect: (stateLabel: string) => `Inspect ${stateLabel}`,
      loading: "Reading wallet holdings",
      readFailed:
        "Wallet holdings could not be loaded. Retry the Base Sepolia read before treating this wallet as empty.",
      partial:
        "Permanent holdings are not available yet. Any collectibles shown here are only the confirmed portion of this wallet.",
      discoveryWaitingTitle: "Waiting for Chainlink randomness",
      discoveryWaiting: (count: number) =>
        `${count} ${count === 1 ? identity.terms.pendingDiscovery : identity.terms.pendingDiscoveryPlural} remain backed by this wallet's ${identity.liquidToken.displayName}. The independently verified response has not arrived yet.`,
      discoveryDelayedTitle: "Chainlink randomness is delayed",
      discoveryDelayed: (count: number) =>
        `${count} ${count === 1 ? identity.terms.pendingDiscovery : identity.terms.pendingDiscoveryPlural} remain backed. No ${identity.terms.transientCollectible} was lost. Keep the corresponding ${identity.liquidToken.displayName} to wait, or move a whole unit away to cancel its still-unseen draw. The protocol will not reroll it.`,
      discoveryReadyTitle: "Randomness verified",
      discoveryReady: (finalized: number, count: number) =>
        `${finalized} of ${count} results are finalized. The remaining work is stored onchain and retryable; the operator completes it in bounded transactions.`,
      discoveryUnknownTitle: `${identity.terms.discoveryDraw} status unavailable`,
      discoveryUnknown:
        "The wallet balance is confirmed, but the detailed randomness status could not be read. Retry before treating the request as failed.",
    },
    craft: {
      eyebrow: `${identity.collectibleToken.symbol} IDENTITY`,
      title: (identityId: number) =>
        `${identity.collectibleToken.symbol} identity #${identityId}`,
      state: "State",
      tier: "Tier",
      track: identity.terms.rewardTrack,
      weight: "Reward weight",
      special: "Special kind",
      owner: "Current owner",
      onchainRecord: "Onchain record",
      viewOnchainIdentity: "View collectible on BaseScan ↗",
      viewOnchainCollection: "View onchain collection ↗",
      noRewardsAccrued: "No rewards accrued yet",
      rewardsUnavailable:
        "Reward evidence for this identity could not be read. Retry the wallet read.",
      directReadFailed:
        "This identity could not be read directly from Base Sepolia. Retry before treating it as missing or unowned.",
      launchConfirmed: `${identity.terms.commitment} confirmed`,
      launchSynchronizing:
        "Updating this craft from the confirmed block. Its permanent state will appear as soon as the collection index catches up.",
      rawUnitsDisclosure: "Show exact raw units",
      attachedRewards: `Attached ${identity.terms.stockReward} units`,
      currentOwnerOnly:
        "Owner-only actions follow the identity's current onchain owner.",
      transientOwnerOnly: `Only the current owner can ${identity.terms.commitment} or transfer this ${identity.terms.transientCollectible}.`,
      permanentOwnerOnly: `Only the current owner can transfer this ${identity.terms.permanentCollectible} or claim attached rewards.`,
      transferTitle: `Transfer ${identity.collectibleToken.name}`,
      transferIntroduction:
        "Send this collectible directly to another Base Sepolia address; no administrator or marketplace stands between.",
      transferRecipient: "Recipient wallet",
      transferRecipientRequired: "Enter the recipient wallet address.",
      transferRecipientInvalid: "Enter a valid nonzero wallet address.",
      transferRecipientSame: "The recipient already owns this identity.",
      transferDisclosure: `The identity, its state, and every unclaimed ${identity.terms.stockReward} unit move together. The recipient becomes the only wallet able to transfer or claim it.`,
      transferAction: `Transfer ${identity.collectibleToken.name}`,
      back: `Back to ${identity.navigation.collection}`,
      notHeld: `Identity details become available when this ${identity.collectibleToken.name} is held by the connected wallet.`,
      holdingsUnavailable: `This identity cannot be classified until the connected wallet holdings finish loading successfully.`,
      identityPanel: "Identity",
      factsPanel: "Facts",
      manifestPanel: "Manifest",
      manifestNote:
        "Published collection manifest, not an onchain read of this identity.",
      manifestUnobserved: "Not observed onchain",
      notDiscoveredTitle: "Not yet discovered",
      notDiscovered: `This identity is still in the available pool; a ${identity.terms.discoveryDraw} assigns it when a wallet crosses a whole ${identity.liquidToken.displayName}.`,
      manifestSpecial: "Special kind",
      manifestOutOfRange: "Outside the published collection.",
      actionsPanel: "Owner actions",
      heldByWallet: "This wallet",
      launchConsequence: `${identity.terms.commitment} consequence`,
      transientConsequence: `Reward claims begin after ${identity.terms.commitment}. ${identity.terms.commitment} burns 1 ${identity.liquidToken.displayName} forever.`,
      permanentConsequence: `Permanent. ${identity.terms.stockReward} units accrue to this ${identity.terms.permanentCollectible}.`,
      rewardsReady: "Attached rewards are ready to claim.",
      rewardsAttached: "Rewards are attached; claiming is not available yet.",
      rewardsNone: "No rewards ready to claim.",
      rewardsUnattached: "None attached",
      lastConfirmed: "Last confirmed",
      lastConfirmedSnapshot: "in the current wallet snapshot",
    },
    launch: {
      title: `${identity.terms.commitment} ${identity.terms.transientCollectible}`,
      finalAction: `Burn 1 ${identity.liquidToken.displayName} and ${identity.terms.commitment}`,
      warning: identity.disclosures.commitment,
      introduction: `This one-way action changes the selected ${identity.terms.transientCollectible} into a permanent ${identity.terms.permanentCollectible}.`,
      confirmationLabel: `I understand that exactly one ${identity.liquidToken.displayName} is burned forever.`,
      reviewAction: `Review ${identity.terms.commitment}`,
      cancelAction: "Cancel and return",
      dialogLabel: `Confirm irreversible ${identity.terms.commitment}`,
      fuelBalance: (balance: string) =>
        `This wallet holds ${balance} ${identity.liquidToken.displayName}.`,
      insufficientFuel: (balance: string) =>
        `${identity.terms.commitment} burns exactly one ${identity.liquidToken.displayName}, and this wallet holds only ${balance}. Buy ${identity.liquidToken.displayName} on Trade first.`,
    },
    rewards: {
      eyebrow: identity.terms.rewardLedger,
      title: identity.navigation.rewards,
      introduction: `Converted ${identity.terms.stockReward} units attached to your ${identity.terms.permanentCollectible}s, claimable by the current owner.`,
      pending: identity.terms.pendingRewards,
      tracksLabel: "Four reward tracks",
      trackMeta: (index: number) => `Track ${index}`,
      allocationOrdinary: `${identity.terms.ordinaryCollectible} ${identity.terms.permanentCollectible}s, by tier weight`,
      allocationBasket: identity.navigation.basketRelics,
      allocationIndicator: identity.navigation.indicatorRelic,
      claimable: "Claimable by this wallet",
      claimTitle: "Claim",
      holdingsTitle: (count: number) =>
        `${count} rewarded ${identity.terms.permanentCollectible}${count === 1 ? "" : "s"}`,
      policyDisclosure: "How eligibility and units work",
      eligible: "Eligible now",
      gated: "Claim unavailable on this deployment",
      gatedExplanation: `This deployment still uses the superseded per-wallet claim policy. Accrued ${identity.terms.stockReward} units remain attached to the identity and are not lost. Self-service claiming becomes available with the ownership-based replacement deployment.`,
      claim: "Claim eligible rewards",
      reviewTitle: "Review claim",
      reviewIntroduction:
        "These identities are included, with the amounts they will claim:",
      rawUnitsDisclosure: "Show exact raw units",
      confirmClaim: "Confirm claim",
      cancelClaim: "Cancel",
      currentOwner:
        "Eligibility follows the current identity owner at claim time. A previous owner cannot claim after transfer.",
      units: identity.disclosures.stockRewardUnits,
      empty: `No attached ${identity.terms.stockReward} units are currently claimable.`,
      connect: `Connect a wallet to review its ${identity.terms.stockReward} units.`,
      loading: "Reading attached rewards",
      readFailed: `Attached ${identity.terms.stockReward} units could not be loaded. Retry the Base Sepolia read before treating this wallet as unrewarded.`,
    },
    relics: {
      eyebrow: "SPECIAL IDENTITIES",
      title: `${identity.navigation.basketRelics} and ${identity.navigation.indicatorRelic}`,
      introduction: `Track the special permanent identities that summarize the ${identity.terms.rewardTrack} system without introducing privileged controls.`,
      stationTitles: [
        `${identity.terms.basketRelic} One`,
        `${identity.terms.basketRelic} Two`,
        `${identity.terms.basketRelic} Three`,
      ],
      indicatorTitle: identity.terms.indicatorRelic,
      kind: "Kind",
      identityLabel: "Identity",
      allocation: "Allocation per track",
      stationAllocation: "⅓ of 12.5%",
      indicatorAllocation: "5%",
      comparisonTitle: `Allocation per ${identity.terms.rewardTrack}`,
      stationsTogether: `Three ${identity.terms.basketRelic}s together`,
      stationsAllocation: `12.5% of every ${identity.terms.rewardTrack}, divided equally`,
      indicatorAllocationLong: `5% of every ${identity.terms.rewardTrack}`,
      ordinaryLabel: `${identity.terms.ordinaryCollectible} ${identity.terms.permanentCollectible}s`,
      ordinaryAllocation: `82.5% of their ${identity.terms.rewardTrack}, by Rarity Tier weight`,
      trackBoardDescription: `Every ${identity.terms.rewardTrack} reserves the same relic allocations, so a relic participates in all four rather than in one.`,
      trackBoardMeta: "ALL FOUR",
      fourTracks: "Four reward tracks",
      ownership: "Ownership",
      heldBadge: "Held",
      notHeldBadge: "Not held",
      unknownBadge: "Unknown",
      noRelicTitle: "No special identity held",
      noRelicBody: `Trading whole ${identity.liquidToken.displayName} can reveal another random ${identity.terms.transientCollectible}; a special identity is never selectable or guaranteed.`,
      noRelicAction: "Continue collecting",
      heldLabel: "Held by this wallet",
      notHeld: "Not held by this wallet",
      ownershipUnknown: "Connect a wallet to check ownership",
      identityNumber: (identityId: number) => `#${identityId}`,
      inspectIdentity: (identityId: number) => `Inspect #${identityId}`,
    },
    cockpit: {
      eyebrow: "OPERATOR COCKPIT",
      title: "Operations overview",
      attentionHeading: "Needs attention",
      attentionEmpty: "No operator action is needed.",
      servicesHeading: "Service and policy",
      rolesHeading: "This wallet's authority",
      canHeading: "Can do",
      cannotHeading: "Cannot do",
      cannotEmpty:
        "Nothing. This wallet holds every capability the console exposes.",
      auditHeading: "Recent control commands",
      auditEmpty: "No control commands have been issued yet.",
      diagnosticsHeading: "Diagnostics",
      diagnosticsHint:
        "Raw protocol reads, addresses, and hashes. Opened deliberately, not by default.",
      storedPolicy: "Stored control-plane policy",
      noScheduledRun: "No run scheduled",
      nextRun: "Next run",
      lastOutcome: (outcome: string) => `Last run: ${outcome}`,
      headline: {
        critical: "Something is broken and needs an operator now",
        warning: "Something needs attention before work runs",
        notice: "Everything is running; one setting is worth reviewing",
        ok: "Every observed service, policy, and check is healthy",
      },
      service: {
        online: "Online",
        degraded: "Heartbeat is late",
        offline: "Offline",
        // Not read yet is not the same claim as down; only the control plane
        // can say a service is offline.
        unknown: "Not read yet",
      },
      automation: {
        stopped: "Stopped",
        "dry-run": "Dry run",
        live: "Live execution",
        unknown: "Not read yet",
      },
      pauses: {
        active: "Active",
        "partially-paused": "Partially paused",
        paused: "Paused",
      },
      work: {
        ready: "Work is ready",
        blocked: "Work is blocked",
        idle: "No work queued",
        unknown: "Cannot determine",
      },
      dependencies: {
        ready: "Inputs readable",
        unavailable: "Inputs unavailable",
        unknown: "Not checked",
      },
      sources: {
        heartbeat: "Operator heartbeat",
        controlPlane: "Control plane",
        onchain: "Base Sepolia read",
        readiness: "Service readiness",
      },
      owners: {
        operator: "Operator process",
        keeper: identity.terms.keeper,
        owner: identity.terms.owner,
        protocol: "Protocol",
      },
      fields: {
        source: "Source",
        observed: "Observed",
        observedAt: "At",
        freshness: "Freshness",
        owner: "Owner",
        impact: "Impact",
        nextStep: "Next step",
      },
      freshness: {
        fresh: "Current",
        stale: "Stale",
        unknown: "Unknown",
      },
      controlHeading: "Automation controls",
      controlIntroduction:
        "These change the stored policy the operator reads at the start of every cycle.",
      controlSignatureNote:
        "Enabling or requesting live execution asks your wallet to sign a short-lived command bound to this deployment.",
      controlCommands: {
        stop: "Stop new runs",
        "enable-dry-run": "Enable recurring dry runs",
        "enable-live": "Enable live execution",
        "request-dry-run": "Request one dry run",
        "request-live-run": "Request one live run",
      },
      controlPending: "Applying…",
      controlUnavailable:
        "The operator control plane is unavailable, so policy cannot be changed. The operator keeps its last stored policy.",
      controlOneShot: (kind: string) => `One ${kind} pass is queued`,
      controlLease: (holder: string) => `Writer lease held by ${holder}`,
      titles: {
        service: "Operator service",
        dependencies: "Dependency readiness",
        automation: "Automation policy",
        pauses: "Protocol pause state",
        work: "Work eligibility",
      },
    },
    operations: {
      eyebrow: "ADMIN / ROLE-GATED OPERATIONS",
      title: "Protocol admin console",
      introduction: `Prepare authorized ${identity.terms.rewardEpoch}, ${identity.terms.deferredTrackBudget}, pause, and ${identity.terms.protocolOwnedLiquidity} actions.`,
      diagnosticsEyebrow: "ADMIN / READ-ONLY EVIDENCE",
      reviewAction: "Review",
      noActionableCapabilityTitle: "No actions for this authority",
      noActionableCapability:
        "This wallet holds a console role but no capability that maps to an action here.",
      reviewTrackConverted: "Queue converted and credited to the track",
      reviewEpochOpened: "A new reward epoch is open",
      reviewPolAdded: "Liquidity added and permanently locked",
      reviewCreatorWithdrawn: "Creator fees transferred to the destination",
      reviewBlockedTitle: "This action cannot be submitted yet",
      reviewPendingReason:
        "Wait for the current privileged transaction to finish before submitting another.",
      reviewTitle: (label: string) => `Review: ${label}`,
      reviewIntroduction:
        "Check this against the pinned snapshot below before your wallet is asked to sign.",
      reviewActor: "Signing wallet",
      reviewRoles: "Held capabilities",
      reviewRequiredRole: "Capability required",
      reviewNetwork: "Network",
      reviewObservedBlock: "Pinned at block",
      reviewSubject: "Module or track",
      reviewCurrentState: "Current state",
      reviewIntendedState: "Intended state",
      reviewAmount: "Amount",
      reviewRange: "Tick range",
      reviewBudget: "WETH budget",
      reviewExpectedOutput: "Expected output",
      reviewMinimumOutput: "Protected minimum",
      reviewQuoteBlock: "Route quoted at block",
      reviewFee: "Fee",
      reviewDeadline: "Must confirm before",
      reviewConsequences: "What this changes",
      reviewSimulating: "Simulating against the current block…",
      reviewConfirm: "Sign and submit",
      reviewCancel: "Cancel",
      reviewNoActor:
        "No signing wallet is connected. Reconnect before submitting.",
      reviewQuoteStale:
        "This route quote is older than the current snapshot. Refresh the quote before submitting.",
      reviewMinimumRoundsToZero:
        "The protected minimum output rounds to zero at this amount, which would remove slippage protection. Increase the amount or wait for a larger queue.",
      reviewTrackConsequence: `Converts the queued WETH through this track's ${identity.terms.sealedRoute} and credits the resulting ${identity.terms.stockReward} units to the track. It reverts rather than filling below the protected minimum.`,
      reviewEpochConsequence:
        "Opens a new reward epoch from the accrued reward pot and fixes each track's share for that epoch.",
      reviewPolConsequence:
        "Adds protocol-owned liquidity in the shown tick range. The added WETH becomes permanently locked liquidity and cannot be withdrawn.",
      reviewCreatorConsequence:
        "Transfers accrued creator fees to the configured creator destination. The destination is set onchain and cannot be chosen here.",
      advancedOverride: "Advanced: set a raw minimum output",
      advancedOverrideWarning:
        "The policy minimum above is derived from a live route quote. A manual value replaces that protection and is only bounded by the contract. Leave this closed unless you are deliberately overriding it.",
      advancedOverrideLabel: "Raw minimum output in stock token units",
      advancedOverrideBelowPolicy:
        "This raw minimum is weaker than the policy minimum derived from the current quote.",
      claimPolicyTitle: "Claim eligibility policy",
      claimPolicyFixed:
        "This deployment binds a fixed policy that approves every current owner. Eligibility cannot be changed here.",
      claimPolicyUndeclared:
        "This deployment's manifest declares no claim policy, so this console cannot tell whether eligibility can be changed.",
      claimPolicyAdministrator: "Policy administrator",
      claimPolicyAccountLabel: "Wallet address",
      claimPolicyApprove: "Approve this wallet",
      claimPolicyRevoke: "Revoke this wallet",
      claimPolicyInvalidAccount: "Enter a valid nonzero wallet address.",
      claimPolicyApproveIntent: "Wallet approved to claim",
      claimPolicyRevokeIntent: "Wallet revoked from claiming",
      claimPolicyApproveConsequence:
        "Lets this wallet claim rewards already attached to identities it holds. It grants no other capability.",
      claimPolicyRevokeConsequence:
        "Prevents this wallet from claiming. Accrued rewards stay attached to the identity and already-claimed balances are untouched.",
      creatorFeeTitle: "Creator fees",
      creatorFeeAccrued: "Accrued and withdrawable",
      creatorFeeDestination: "Destination",
      creatorWithdrawAll: "Withdraw all",
      creatorWithdrawAmount: "Withdraw an exact amount",
      creatorAmountLabel: "WETH amount",
      creatorNoBalance: "No creator fees have accrued yet.",
      creatorAmountInvalid:
        "Enter a positive WETH amount with up to 18 decimal places.",
      pauseBlastRadius: {
        liquidToken: {
          stops:
            "Stops all collector transfers, trades, and Commitment for the liquid token and its collectibles. Reads, the faucet, and admin sign-in stay available.",
          resumes:
            "Restores collector transfers, trades, and Commitment for the liquid token and its collectibles.",
          remains:
            "Reward claims and protocol-owned liquidity are governed separately.",
        },
        rewards: {
          stops:
            "Stops new reward accounting and reward claims. Already-claimed balances are unaffected, and collectors can still trade.",
          resumes: "Restores new reward accounting and reward claims.",
          remains: "Trading and Commitment are governed separately.",
        },
        converter: {
          stops:
            "Stops reward-epoch opening and every reward-track conversion, including operator retries. Queued WETH stays queued.",
          resumes:
            "Restores reward-epoch opening and reward-track conversions.",
          remains:
            "Collector trading and reward claims are governed separately.",
        },
        liquidity: {
          stops:
            "Stops protocol-owned liquidity cycles. Already-locked liquidity is unaffected and stays locked.",
          resumes: "Restores protocol-owned liquidity cycles.",
          remains:
            "Collector trading and reward accounting are governed separately.",
        },
      },
      automationTrackState: {
        fresh: "Resolved",
        retryable: "Retry needed",
        unknown: "Not resolved",
      },
      diagnosticsTitle: "Protocol diagnostics",
      diagnosticsIntroduction:
        "Inspect live onchain health, exact deployment evidence, accounting checks, indexed operational history, and recent bounded events without preparing a transaction.",
      diagnosticsReadUnavailable:
        "Diagnostics could not read live onchain evidence. No expected binding, role, or healthy state is inferred.",
      retryDiagnostics: "Retry diagnostics",
      evidenceSources: "Evidence sources",
      evidenceSourcesIntroduction:
        "Every status names where its evidence comes from; worker liveness is never inferred from contract state.",
      keeperAttemptHeading: "Keeper attempt evidence",
      keeperAttemptIntroduction:
        "The latest persisted cycle by Reward Track; uncertain receipts stay unknown until canonical reconciliation succeeds.",
      sourceGeneration: "Source generation",
      evidenceAge: "Evidence age",
      evidenceObservedAt: "Chain observation",
      evidenceRecordedAt: "Journal completion",
      rawAccountingEvidence: "Raw onchain accounting and queues",
      completeHealthLedger: "Complete health-check ledger",
      roleEvidence: "Role and authority addresses",
      indexedEventEvidence: "Indexed bounded event evidence",
      diagnosticSources: {
        onchain: {
          label: "Live onchain snapshot",
          description:
            "Direct contract and block reads from the selected Base Sepolia deployment.",
        },
        "operational-index": {
          label: "Operational history index",
          description:
            "Indexed bounded events used for attempts, retries, and recent operations.",
        },
        "reward-index": {
          label: "Reward history index",
          description:
            "Indexed epoch, stock-conversion, and collector-claim history.",
        },
        funding: {
          label: "Testnet funding service",
          description:
            "A direct status read from the separate faucet worker for the connected wallet.",
        },
        "keeper-attempts": {
          label: "Keeper attempt journal",
          description:
            "Persisted action milestones and canonically reconciled transaction outcomes; separate from event history and process liveness.",
        },
        automation: {
          label: "Keeper and liquidity workers",
          description:
            "Completed transactions are onchain evidence; current offchain process liveness requires a process supervisor.",
        },
      },
      diagnosticState: {
        healthy: "Healthy",
        degraded: "Degraded",
        critical: "Critical",
        observed: "Observed",
        partial: "Partial",
        unknown: "Not observed",
        complete: "Complete",
        ready: "Ready",
        disabled: "Disabled",
        "inventory-empty": "Inventory empty",
        loading: "Checking",
        unavailable: "Unavailable",
        fresh: "Fresh",
        stale: "Stale",
        incomplete: "Incomplete",
        "not-checked": "Connect on Base Sepolia to check",
        "not-inferable": "Not inferable from onchain state",
      },
      back: "Open public protocol status",
      epoch: identity.terms.rewardEpoch,
      epochCount: `${identity.terms.rewardEpoch} count`,
      lastEpoch: `Last ${identity.terms.rewardEpoch}`,
      nextEpoch: `Next ${identity.terms.rewardEpoch}`,
      readyNow: "Ready now",
      queue: "Queued WETH",
      deferred: identity.terms.deferredTrackBudget,
      outcome: "Latest conversion",
      retry: "Retry state",
      noControls: "No privileged role is inferred from a connected wallet.",
      accessEyebrow: "ADMIN ACCESS",
      checkingRolesTitle: "Checking admin roles",
      checkingRolesBody:
        "The connected wallet's onchain roles are being read before any protocol controls are shown.",
      roleReadFailedTitle: "Admin roles unavailable",
      roleReadFailedBody:
        "Base Sepolia did not complete the role read. Protocol controls remain hidden until authority can be verified.",
      retryRoleRead: "Retry role check",
      noRoleTitle: "No admin role detected",
      noRoleBody:
        "This wallet has no observed owner, keeper, executor, guardian, or recovery role. The operator console remains hidden.",
      connectedAuthority: "Connected authority",
      capabilities: "Observed capabilities",
      roleConfiguration: "Role configuration",
      actionDeck: "Authorized action deck",
      openEpoch: `Open ${identity.terms.rewardEpoch}`,
      executeTrack: (track: string) => `Execute ${track}`,
      retryTrack: (track: string) => `Retry ${track}`,
      minimumStockOutput: `Minimum ${identity.terms.stockReward} output (raw token units)`,
      executePol: `Execute ${identity.terms.protocolOwnedLiquidity}`,
      polQueue: `${identity.terms.protocolOwnedLiquidity} WETH available`,
      pauseControls: "Pause controls",
      pause: (module: string) => `Pause ${module}`,
      resume: (module: string) => `Resume ${module}`,
      viewOnly: "View-only security boundary",
      recoveryViewOnly: `${identity.terms.recoveryAuthority} and sealed configuration remain view-only. This console cannot recover assets, redirect destinations, or replace sealed routes.`,
      ordinaryWallet: "Ordinary wallet",
      owner: identity.terms.owner,
      liquidTokenModule: identity.liquidToken.displayName,
      liquidTokenOwner: `${identity.liquidToken.displayName} ${identity.terms.owner}`,
      rewardsOwner: `${identity.terms.rewardLedger} ${identity.terms.owner}`,
      converterOwner: `${identity.terms.rewardEpoch} ${identity.terms.owner}`,
      liquidityOwner: `${identity.terms.protocolOwnedLiquidity} ${identity.terms.owner}`,
      keeper: identity.terms.keeper,
      executor: identity.terms.liquidityExecutor,
      polModule: identity.terms.protocolOwnedLiquidity,
      guardian: identity.terms.guardian,
      recovery: identity.terms.recoveryAuthority,
      creator: identity.terms.creator,
      frozen: "Connected wallet frozen",
      notFrozen: "Connected wallet not frozen",
      walletState: "Wallet state",
      capabilityHeld: "Held",
      queuedWethTotal: "Queued WETH",
      pauseState: "Pause state",
      operatorState: "Operator state",
      evidenceDetail: "Testnet conditions and units",
      trackQueueBoard: "Reward track queues",
      rawUnits: "Raw units",
      expectedChainId: "Expected chain",
      observedChainId: "Observed chain",
      recentActions: "Recent operational events",
      noRecentActions: "No bounded operational events were observed.",
      disclosure: `${identity.disclosures.testnet} ${identity.disclosures.stockRewardUnits}`,
    },
    access: {
      disconnectedTitle: "Wallet not connected",
      disconnectedBody:
        "Public protocol data remains visible. Connect a wallet to load holdings and prepare transactions.",
      wrongNetworkTitle: "Wrong network",
      wrongNetworkBody:
        "Switch the connected wallet to Base Sepolia before preparing an operation.",
      deploymentPendingTitle: "Deployment record pending",
      deploymentPendingBody: identity.copy.protocolPending,
      readyTitle: "Wallet ready",
      readyBody: "Live reads and transaction preparation are available.",
      walletLoadingTitle: "Reading wallet data",
      walletLoadingBody:
        "Balances and holdings are loading from the latest Base Sepolia block.",
      walletFailedTitle: "Wallet data could not be read",
      walletFailedBody:
        "Base Sepolia did not complete the wallet read. No missing balance or holding is being treated as zero.",
      walletPartialTitle: "Wallet data is partially available",
      walletPartialBody:
        "Balances loaded, but at least one holdings or reward-detail read failed. Incomplete sections are marked explicitly.",
      retryWalletRead: "Retry wallet read",
    },
    transaction: {
      idle: "Ready for review",
      pending: "Confirm in your wallet",
      simulated: "Simulation passed",
      submitted: "Submitted to Base Sepolia",
      outcomeUnknown: "Submitted outcome unknown",
      outcomeUnknownMessage:
        "Base Sepolia has not returned this submitted transaction's outcome yet. Check the existing transaction before taking another action.",
      confirmed: "Confirmed on Base Sepolia",
      synchronizing:
        "Updating wallet data from the confirmed block. Wait for the new state before taking another action.",
      reverted:
        "The transaction was mined but reverted. No protocol state changed.",
      failed: "Transaction failed",
      retriable: "Retry available",
      retry: "Try again",
      reconcile: "Check submitted outcome",
      reconciling: "Checking submitted outcome…",
      approval: (asset: string) => `Approve ${asset} for exchange`,
      approvalConfirmed:
        "The approval is confirmed; no exchange was submitted. Review the refreshed trade details, then select Submit exchange to continue.",
      explorer: "View transaction",
    },
    status: {
      health: {
        healthy: "Healthy",
        degraded: "Degraded",
        critical: "Critical",
      },
      history: {
        unknown: "Not observed yet",
        observed: "Observed",
        partial: "Partial history",
      },
      queue: {
        unknown: "Not observed yet",
        paused: "Paused",
        retryable: "Retry available",
        clear: "Queue clear",
        ready: "Ready",
      },
      accounting: {
        unknown: "Not observed yet",
        observed: "Observed",
      },
      check: {
        healthy: "Healthy",
        warning: "Warning",
        failing: "Failing",
        fresh: "Fresh",
        stale: "Stale",
        evidence: "Expected / observed evidence",
        expected: "Expected",
        observed: "Observed",
        observedBlock: "Observed block",
      },
    },
    common: {
      unavailable: "Unavailable",
      loading: "Loading live protocol data",
      readFailed: "Read failed",
      notLoaded: "Not loaded",
      notObserved: "Not observed yet",
      refresh: "Refresh",
      returnHome: "Return to the protocol overview",
      openLearn: "Open Learn and verify",
    },
    routeCrash: {
      eyebrow: "Route error",
      title: "This page hit an unexpected error",
      introduction:
        "The rest of the application is unaffected; retry the page, and if it keeps failing the protocol state is still readable on the status page.",
      retry: "Retry this page",
      status: "Open protocol status",
    },
  }) as const;

export type IdentityApplicationCopy = ReturnType<
  typeof createIdentityApplicationCopy
>;

/**
 * The application protocol language is constructed only from the selected
 * identity adapter. Protocol mechanics consume this object instead of owning
 * product vocabulary or visible prose themselves.
 */
export const createIdentityProtocolCopy = (identity: IdentityConfiguration) => {
  const terms = identity.terms;
  return {
    labels: {
      market: terms.canonicalMarket,
      claimGate: terms.claimGate,
      rewardLedger: terms.rewardLedger,
      rewardEpoch: terms.rewardEpoch,
      rewardTrack: terms.rewardTrack,
      deferredTrackBudget: terms.deferredTrackBudget,
      sealedRoute: terms.sealedRoute,
      settlementAsset: terms.settlementAsset,
      conversionAsset: terms.conversionAsset,
      stockReward: terms.stockReward,
      pendingRewards: terms.pendingRewards,
      protocolOwnedLiquidity: terms.protocolOwnedLiquidity,
      genesisLiquidity: terms.genesisLiquidity,
      keeper: terms.keeper,
      owner: terms.owner,
      liquidityExecutor: terms.liquidityExecutor,
      creator: terms.creator,
    },
    errors: {
      tradingLocked: `Trading is not available before ${identity.brand} launches.`,
      invalidOwnership: `The connected wallet does not own this ${identity.collectibleToken.name}.`,
      claimDenied: `This deployment's legacy claim policy blocked the transaction. The ${terms.stockReward} units remain attached to the identity and are not lost.`,
      claimBatchTooLarge: "This claim contains too many identities.",
      rewardsPaused: `New ${terms.stockReward} accounting is paused.`,
      modulePaused: "This protocol action is currently paused.",
      accountFrozen:
        "The connected wallet is frozen by the configured authority.",
      unauthorizedKeeper: `The connected wallet is not the configured ${terms.keeper}.`,
      unauthorizedExecutor: `The connected wallet is not the configured ${terms.liquidityExecutor}.`,
      unauthorizedOwner: `The connected wallet is not the configured ${terms.owner}.`,
      configurationSealed: "This protocol configuration is permanently sealed.",
      emptyTrackQueue: `This ${terms.rewardTrack} has no ${terms.deferredTrackBudget} to execute.`,
      epochPending: `The next ${terms.rewardEpoch} interval has not elapsed.`,
      rewardPotBelowMinimum: `The reward pot has not reached the minimum ${terms.rewardEpoch} size.`,
      deadlineExpired: "Refresh this operation before trying again.",
      rpcFailure: "The latest protocol read could not be completed.",
    },
    events: {
      rewardEpochSucceeded: `A ${terms.rewardEpoch} opened successfully.`,
      conversionSucceeded: `A ${terms.sealedRoute} converted its ${terms.deferredTrackBudget} successfully.`,
      claimSucceeded: `A current identity owner claimed attached ${terms.stockReward} units.`,
      liquiditySucceeded: `Queued WETH entered a permanently locked ${terms.protocolOwnedLiquidity} position.`,
      rewardEpochFailed: `A ${terms.rewardEpoch} transaction reverted.`,
      conversionFailed: `A ${terms.sealedRoute} conversion reverted.`,
      claimFailed: `A ${terms.stockReward} claim transaction reverted.`,
      liquidityFailed: `A ${terms.protocolOwnedLiquidity} execution reverted.`,
      retrySucceeded: `A failed-track retry converted its ${terms.deferredTrackBudget} successfully.`,
      retryFailed: `A failed-track retry reverted; its ${terms.deferredTrackBudget} remains queued.`,
      initialConversionFailed: `A ${terms.sealedRoute} conversion reverted; its ${terms.deferredTrackBudget} is retryable.`,
      trackAttemptUnknown: `A ${terms.sealedRoute} attempt was observed without enough preceding failed-call history to classify it as an initial conversion or retry.`,
    },
    health: {
      freshness: "Health decisions must use a recent observed block.",
      chain: "The observed chain must match the selected deployment manifest.",
      feePotReconciliation:
        "The Canonical Market hook WETH balance must cover its three destination-locked fee pots. Unsolicited excess WETH is reported without making the accounting insolvent.",
      rewardQueueReconciliation:
        "The Reward Epoch converter WETH balance must cover all four track queues. Unsolicited excess WETH is reported without making the accounting insolvent.",
      liquidityQueueReconciliation:
        "The Protocol-Owned Liquidity vault WETH balance must cover its recorded queue. Unsolicited excess WETH is reported without making the accounting insolvent.",
      backingExpected: (accounted: bigint) => `balance >= ${accounted}`,
      backingObserved: (accounted: bigint, balance: bigint) =>
        balance >= accounted
          ? `balance ${balance}; excess ${balance - accounted}`
          : `balance ${balance}; shortfall ${accounted - balance}`,
      marketLiquidity:
        "The Canonical Market must retain positive active liquidity.",
      positiveLiquidity: "positive active liquidity",
      activeState: "active",
      pausedState: "paused",
      unfrozenState: "not frozen",
      frozenState: "frozen",
      progressingTrack: "clear or executable",
      clearTrack: "queue clear",
      executableTrack: "ready to execute",
      deferredTrack: `retryable ${terms.deferredTrackBudget}`,
      accountingSnapshotExpected: "complete accounting observation",
      accountingSnapshot: (
        activeWeight: bigint,
        unclaimedPot: bigint,
        basketPot: bigint,
        indicatorPot: bigint,
      ) =>
        `active weight ${activeWeight}; unclaimed ${unclaimedPot}; basket ${basketPot}; indicator ${indicatorPot}`,
      rewardAccountingSnapshot: (track: string) =>
        `${track} active weight and ordinary, Basket Relic, and Indicator Relic pots are observed from the Reward Ledger.`,
      lockedLiquidityExpected:
        "zero locked WETH before the first cycle; positive locked WETH after a completed cycle",
      lockedLiquidityObserved: (cycles: bigint, lockedWeth: bigint) =>
        `${cycles} cycles; ${lockedWeth} WETH locked`,
      lockedLiquidity:
        "Completed Protocol-Owned Liquidity cycles must leave WETH permanently accounted as locked.",
      connectedWalletFreeze:
        "The connected wallet freeze state is enforced before operator actions.",
      modulePause: (module: string) =>
        `${module} reports its explicit operational pause state.`,
      trackProgress: (track: string) =>
        `${track} is clear, executable, or isolated as a retryable Deferred Track Budget.`,
      supplyInvariant: `The ${identity.liquidToken.displayName} supply plus one whole unit for every permanent ${identity.collectibleToken.name} identity must remain 4,444 units.`,
      collectionPartition: `Every identity must be available, ${terms.transientCollectible}, or ${terms.permanentCollectible} exactly once; ${terms.pendingDiscovery} requests do not reserve an identity before fulfillment.`,
      identityManifest:
        "The sealed collection assignment must match the deployment manifest.",
      bytecode: (name: string) =>
        `${name} must contain deployed contract bytecode.`,
      rewardSolvency: (track: string) =>
        `${track} held by the ${terms.rewardLedger} must cover its attached ${terms.pendingRewards}.`,
      claimPolicyImplementation: `The bound ${terms.claimGate} must be the implementation the deployment manifest declared. A different implementation would change who can claim without any manifest change.`,
      rpcFailure: "A bounded public read failed; no healthy value is inferred.",
      unavailable: "unavailable",
      maximumAge: (seconds: number) => `at most ${seconds}s old`,
      observedAge: (seconds: number) => `${seconds}s old`,
      deployedAt: (address: string) => `deployed at ${address}`,
      bytecodePresent: "bytecode present",
      bytecodeMissing: "no bytecode",
      sealedExpected: "sealed",
      sealedObserved: "sealed",
      mutableObserved: "mutable",
      balanceAtLeast: (liability: bigint) => `balance >= ${liability}`,
      roleBinding: (role: string) =>
        `The configured ${role} matches the deployment manifest.`,
      claimGateAdministrator:
        "The configurable claim gate is owned by the recorded policy administrator, who alone can change wallet eligibility.",
      claimGatePendingAdministrator:
        "No claim-gate ownership nomination is outstanding. Whoever holds one can take the gate -- and every collector's claim eligibility -- by accepting it.",
      venueBlockedExpected: "blocked",
      venueBlockedObserved: "blocked",
      venueReachableObserved: "reachable",
      blockedVenue: (label: string, codehash: string) =>
        `The alternative venue ${label} (${codehash}) is still blocked on chain. The blocklist is frozen at launch, so the recorded inventory is final and cannot be repaired in place.`,
      pendingOwnerBinding: (role: string) =>
        `Any ${role} ownership nomination matches the deployment manifest -- including none at all -- so no unreviewed address can take the module by accepting.`,
      roleLabels: {
        liquidTokenOwner: `${identity.liquidToken.displayName} ${terms.owner}`,
        rewardLedgerOwner: `${terms.rewardLedger} ${terms.owner}`,
        rewardEpochOwner: `${terms.rewardEpoch} ${terms.owner}`,
        canonicalMarketOwner: `${terms.canonicalMarket} ${terms.owner}`,
        liquidityOwner: `${terms.protocolOwnedLiquidity} ${terms.owner}`,
        guardian: terms.guardian,
        recoveryAuthority: terms.recoveryAuthority,
        keeper: terms.keeper,
        liquidityExecutor: terms.liquidityExecutor,
        creator: terms.creator,
      },
      deploymentBinding: (component: string, dependency: string) =>
        `The ${component} binding to ${dependency} matches the pinned deployment manifest.`,
      deploymentLabels: {
        mirror: `${identity.collectibleToken.name} mirror`,
        metadata: `${identity.collectibleToken.name} metadata`,
        ledger: terms.rewardLedger,
        converter: terms.rewardEpoch,
        market: terms.canonicalMarket,
        hook: `${terms.canonicalMarket} fee routing`,
        router: `${terms.canonicalMarket} router`,
        liquidity: terms.protocolOwnedLiquidity,
        genesis: terms.genesisLiquidity,
        venue: `${terms.sealedRoute} venue`,
        core: identity.liquidToken.displayName,
        metadataRenderer: `${identity.collectibleToken.name} metadata renderer`,
        attributeRegistry: `${identity.collectibleToken.name} attribute registry`,
        fuelCore: identity.liquidToken.displayName,
        claimGate: terms.claimGate,
        epochConverter: terms.rewardEpoch,
        weth: terms.settlementAsset,
        rewardLedger: terms.rewardLedger,
        feeHook: `${terms.canonicalMarket} fee routing`,
        manager: `${terms.canonicalMarket} pool manager`,
        fuel: identity.liquidToken.displayName,
        owner: terms.owner,
        registry: `${terms.canonicalMarket} registry`,
        rewardDestination: `${terms.rewardEpoch} destination`,
        liquidityDestination: `${terms.protocolOwnedLiquidity} destination`,
        creatorDestination: `${terms.creator} destination`,
      },
      adapterConverter: `The ${terms.sealedRoute} accepts only its ${terms.rewardEpoch} converter.`,
      adapterSettlement: `The ${terms.sealedRoute} starts with the ${terms.settlementAsset}.`,
      adapterConversion: `The ${terms.sealedRoute} uses the configured ${terms.conversionAsset}.`,
      adapterReward: `The ${terms.sealedRoute} ends at its configured ${terms.stockReward}.`,
      adapterLedger: `Converted ${terms.stockReward} units arrive only at the ${terms.rewardLedger}.`,
      adapterVenue: "The POC route uses its recorded conversion venue.",
      ledgerTrack: `The ${terms.rewardLedger} liability is denominated in the pinned ${terms.stockReward} token.`,
      converterTrackToken: `The ${terms.sealedRoute} output token matches the ${terms.rewardLedger} track.`,
      converterTrackAdapter: `The ${terms.sealedRoute} uses the manifest-selected conversion adapter.`,
      adapterTrack: `The adapter serves exactly one ${terms.rewardTrack}.`,
      firstHop: "The first conversion hop matches the manifest.",
      secondHop: "The second conversion hop matches the manifest.",
      fuelLedger: `${identity.liquidToken.displayName} rewards reach the sealed ${terms.rewardLedger}.`,
      fuelMarket: `${identity.liquidToken.displayName} settlement uses the ${terms.canonicalMarket} registry.`,
      marketRegistered: `The ${terms.canonicalMarket} pool is registered before public launch.`,
      marketPool: `The registered ${terms.canonicalMarket} pool matches the manifest.`,
      marketHook: `The manifest pool identity includes the deployed ${terms.canonicalMarket} fee hook.`,
      launched: "Public trading starts only after the one-way launch.",
      marketFee: `The ${terms.canonicalMarket} trading fee remains 3%.`,
      attributesSealed: "Collection attributes are immutable.",
      marketSealed: `The ${terms.canonicalMarket} is immutable.`,
      routesSealed: `${terms.sealedRoute} configuration cannot be redirected.`,
      liquiditySealed: `${terms.protocolOwnedLiquidity} uses the sealed fee destination.`,
      genesisSeeded: `${terms.genesisLiquidity} was seeded and permanently locked.`,
      discoveryExemptions:
        "Protocol-account discovery exemptions froze at launch.",
      metadataSealed: "The selected product identity metadata froze at launch.",
    },
    reader: {
      network: "Network",
      walletBlock: "Wallet observation block",
      walletSummary: "Wallet summary",
      walletCollectibles: `${identity.collectibleToken.name} wallet holdings`,
      walletPermanentCollectibles: `Permanent ${identity.collectibleToken.name} wallet holdings`,
      walletCollectibleDetails: `${identity.collectibleToken.name} wallet details`,
      quoteBlock: `${terms.canonicalMarket} quote block`,
      trackQuote: `${terms.rewardTrack} route quote`,
      claimPolicy: `${terms.claimGate} implementation`,
      exchangeAllowance: `${terms.canonicalMarket} exchange allowance`,
      operationsBlock: "Protocol operations block",
      healthBlock: "Protocol health block",
      protocolHealth: "Protocol health",
      identityAttributes: (identityId: number) =>
        `${identity.collectibleToken.name} identity ${identityId} attributes`,
      identityPendingRewards: (identityId: number) =>
        `${identity.collectibleToken.name} identity ${identityId} ${terms.pendingRewards}`,
      identityRewardActivation: (identityId: number) =>
        `${identity.collectibleToken.name} identity ${identityId} ${terms.stockReward} activation`,
      recentOperations: "Recent protocol operations",
      missingRpcResult: (key: string) => `${key}: missing RPC result`,
      bytecodeRead: (name: string) => `${name} bytecode`,
      contractLabels: {
        fuelCore: identity.liquidToken.displayName,
        fuelMirror: identity.collectibleToken.name,
        attributeRegistry: `${identity.collectibleToken.name} attribute registry`,
        rewardLedger: terms.rewardLedger,
        claimGate: terms.claimGate,
        discoveryAdapter: `${terms.pendingDiscovery} adapter`,
        epochConverter: terms.rewardEpoch,
        canonicalMarketRegistry: `${terms.canonicalMarket} registry`,
        canonicalFeeHook: `${terms.canonicalMarket} fee routing`,
        canonicalRouter: `${terms.canonicalMarket} router`,
        canonicalHookDeployer: `${terms.canonicalMarket} deployment helper`,
        protocolLiquidityVault: terms.protocolOwnedLiquidity,
        genesisLiquidityVault: terms.genesisLiquidity,
        uniswapV4PoolManager: `${terms.canonicalMarket} pool manager`,
        metadataRenderer: `${identity.collectibleToken.name} metadata renderer`,
        testConversionVenue: `${terms.sealedRoute} venue`,
        usdc: terms.conversionAsset,
        weth: terms.settlementAsset,
        mockAaplc: identity.rewardTrackLabels[1],
        mockGooglc: identity.rewardTrackLabels[2],
        mockMetac: identity.rewardTrackLabels[3],
        mockNvdac: identity.rewardTrackLabels[4],
        aaplcConversionAdapter: `${identity.rewardTrackLabels[1]} ${terms.sealedRoute}`,
        googlcConversionAdapter: `${identity.rewardTrackLabels[2]} ${terms.sealedRoute}`,
        metacConversionAdapter: `${identity.rewardTrackLabels[3]} ${terms.sealedRoute}`,
        nvdacConversionAdapter: `${identity.rewardTrackLabels[4]} ${terms.sealedRoute}`,
      },
    },
    domain: {
      marketPricePositive: `${terms.canonicalMarket} square-root price must be positive`,
      marketMissingLiquidToken: `${terms.canonicalMarket} does not contain ${identity.liquidToken.displayName}`,
      missingAttributes: (identityId: number) =>
        `Missing ${identity.collectibleToken.name} attributes for identity ${identityId}`,
      invalidAttributes: (identityId: number) =>
        `Invalid ${identity.collectibleToken.name} attributes for identity ${identityId}`,
    },
    transactions: {
      walletRequired: "Connect a wallet before preparing a transaction.",
      wrongChain: (chainId: number) =>
        `Switch to chain ${chainId} before preparing a transaction.`,
      wrongChainObserved: (expected: number, observed: number) =>
        `Expected chain ${expected}, received ${observed}.`,
      unsupportedRole: (role: string) =>
        `The connected wallet is not the configured ${role}.`,
      moduleOwner: (
        module: "liquidToken" | "rewards" | "converter" | "liquidity",
      ) =>
        `${
          module === "liquidToken"
            ? identity.liquidToken.displayName
            : module === "rewards"
              ? terms.rewardLedger
              : module === "converter"
                ? terms.rewardEpoch
                : terms.protocolOwnedLiquidity
        } ${terms.owner}`,
      claimIneligible: `Every claimed identity must be a permanent ${identity.collectibleToken.name}, owned, and eligible.`,
      claimBatchTooLarge: (maximum: number) =>
        `Claim at most ${maximum} eligible identities in one transaction.`,
      protocolNotLaunched: `${identity.brand} has not launched for public ${terms.commitment} actions.`,
      transientNotOwned: `The selected ${terms.transientCollectible} is not owned by the connected wallet.`,
      commitmentPaused: `${terms.commitment} actions are currently paused.`,
      collectibleNotOwned: `The connected wallet does not own the selected ${identity.collectibleToken.name}.`,
      invalidRecipient: "Choose a nonzero transaction recipient.",
      transferPaused: (label: string) =>
        `${label} transfers are currently paused.`,
      staleQuote: `Refresh the ${terms.canonicalMarket} quote before swapping.`,
      discoveryEvidenceUnavailable: `Refresh the ${terms.canonicalMarket} quote so the connected wallet's discovery boundary can be checked before swapping.`,
      discoveryEvidenceInvalid: `Refresh the ${terms.canonicalMarket} quote because its wallet discovery evidence no longer matches this transaction.`,
      discoveryMutationLimit: (
        mutations: number,
        maximum: number,
        maximumAmount: string,
      ) =>
        `This trade crosses ${mutations} whole-unit discovery boundaries, but one transfer can cross at most ${maximum}. Reduce the ${identity.liquidToken.displayName} amount to ${maximumAmount} or less, or split it into smaller swaps and request a fresh quote before each submission.`,
      invalidApproval: `Choose a nonzero ${identity.liquidToken.displayName} or WETH approval amount.`,
      marketUnavailable: `${terms.canonicalMarket} trading is not currently available.`,
      epochPrecondition: `The ${terms.rewardEpoch} pause, interval, and minimum-pot conditions must all be satisfied.`,
      retryPrecondition: `This track needs a recent failed attempt, a queued ${terms.deferredTrackBudget}, and a fresh deadline before retry.`,
      executionPrecondition: `This initial track execution needs a non-empty ${terms.rewardTrack} queue, an unpaused converter, and a valid deadline.`,
      liquidityPrecondition: `${terms.protocolOwnedLiquidity} requires sealed configuration, aligned int24 ticks, bounded nonzero liquidity, a WETH budget, and a fresh deadline.`,
      sealedMutation: `${terms.sealedRoute} configuration cannot be changed after sealing.`,
      claimPolicyNotConfigurable: `This deployment binds a fixed ${terms.claimGate} that cannot deny or approve individual wallets. Bind the configurable policy in a new checked deployment to change eligibility.`,
      claimPolicyAdministratorOnly: `Only the documented ${terms.claimGate} policy administrator can change wallet eligibility.`,
      claimPolicyInvalidAccount: "Choose a nonzero wallet address.",
      creatorPotUnavailable: `The accrued ${terms.creator} fee balance could not be read. Refresh the protocol snapshot before withdrawing.`,
      creatorWithdrawalPositive: `Choose a ${terms.creator} withdrawal amount greater than zero.`,
      creatorWithdrawalOverdraw: `This amount is larger than the accrued ${terms.creator} fee balance.`,
      identityMismatch: (adapter: string, deployment: string) =>
        `Identity adapter ${adapter} does not match deployment ${deployment}.`,
    },
  } as const;
};

export type IdentityProtocolCopy = ReturnType<
  typeof createIdentityProtocolCopy
>;

// This is the only input changed when selecting the product identity for a deployment.
export const selectedIdentityKey: IdentityConfigurationKey = "orbit-4444";

export const selectedIdentityConfiguration =
  selectIdentityConfiguration(selectedIdentityKey);
