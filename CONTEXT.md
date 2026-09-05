# Base Collectible Rewards

An original Base-native collectible economy inspired by QUOTRONS. It combines liquid ownership, irreversible collectible commitment, and stock-token rewards without copying the QUOTRONS identity.

## Working identity

**ORBIT 4444**:
The provisional user-facing identity: Fuel maps to the Liquid Token, a Grounded Craft to a Transient Collectible, Launch to Commitment, an Orbiter to a Permanent Collectible, three Stations to the Basket Relics, and the Observatory to the Indicator Relic. The neutral domain language below remains authoritative until the identity is frozen for production launch.
_Avoid_: Final launch identity, protocol vocabulary

## Language

**Liquid Token**:
The fungible, tradable side of the collection. Each whole unit is paired with a Transient Collectible—or briefly awaits its Discovery Draw—until that unit is committed or the holder's balance falls below it.
_Avoid_: QUOTRON, share

**Transient Collectible**:
A collectible paired with one whole Liquid Token that can return to the available collection when its paired whole-unit ownership ends.
_Avoid_: Dark terminal, permanent NFT

**Discovery Draw**:
The selection of one available collectible identity when a non-exempt wallet gains a whole Liquid Token. Identities are drawn without replacement while held, a dissolved Transient Collectible returns to the available pool, and a production recipient cannot reject an observed identity and retry the same acquisition for another.
_Avoid_: NFT mint sale, user-selected identity

**Pending Discovery**:
The temporary state of a newly gained whole Liquid Token while its production Discovery Draw is unresolved. The Liquid Token remains tradable, but its unseen collectible cannot be committed or transferred as an NFT; losing that whole unit cancels the pending discovery without revealing its result.
_Avoid_: Locked token, collectible rarity

**Discovery Batch**:
One acquisition's ordered group of Pending Discoveries sharing a single verifiable random seed. A batch becomes ready together and is finalized in acquisition order, even when its state changes are applied through several retryable transactions.
_Avoid_: Eight-word chunk, independent mint requests

**Delayed Discovery**:
A Pending Discovery whose external randomness has not arrived within the published service threshold. It remains safely backed and cancellable through ordinary Liquid Token movement; it is an observable oracle incident, not a failed or missing asset.
_Avoid_: Failed mint, lost collectible

**Commitment**:
The irreversible choice to surrender one whole Liquid Token's fungibility and make its paired Transient Collectible permanent and reward-eligible.
_Avoid_: Hardwire, stake, lock

**Permanent Collectible**:
A committed collectible that no longer depends on a Liquid Token balance and participates in its assigned Reward Track.
_Avoid_: Hardwired terminal, staked NFT

**Rarity Tier**:
An immutable class assigned to an ordinary collectible that determines its relative reward weight within a Reward Track.
_Avoid_: Interest rate, guaranteed return

**Reward Track**:
The permanent association between a collectible and one supported tokenized-stock reward asset. In each track, 82.5% of converted rewards belongs to ordinary Permanent Collectibles according to Rarity Tier weight, 12.5% is shared equally by the three Basket Relics, and 5% belongs to the Indicator Relic.
_Avoid_: Dividend class, stock ownership

**Basket Relic**:
One of three unique collectibles that receives one-third of the 12.5% Basket Relic allocation reserved in every Reward Track rather than belonging to only one track.
_Avoid_: Ordinary collectible, diversified fund

**Indicator Relic**:
The unique collectible that receives the 5% Indicator Relic allocation reserved in every Reward Track.
_Avoid_: Ordinary collectible, index fund

**Canonical Reward Set**:
The tokenized stocks publicly launched by Base and selected as active Reward Tracks. The initial set is AAPLc, GOOGLc, METAc, and NVDAc.
_Avoid_: Every documented B20 address, QUOTRONS' ten-stock set

**Stock Reward**:
A distribution of tokenized stock funded by activity in the collectible economy. It is not a dividend, protocol equity, or a claim on project revenue.
_Avoid_: Dividend, passive income, guaranteed yield

**Eligible Recipient**:
A non-US recipient who satisfies the issuer's applicable jurisdiction and policy requirements for receiving a Stock Reward.
_Avoid_: Any wallet, permissionless claimant

**Operator Jurisdiction**:
Singapore, provisionally, as the home jurisdiction from which the protocol would be operated. This assumption must be validated by Singapore counsel before any live Stock Reward acquisition or distribution.
_Avoid_: User location, incorporation completed, legal clearance

**Claim Eligibility**:
A Permanent Collectible's current owner may claim its Pending Rewards automatically. Eligibility follows identity ownership and requires no operator or per-wallet approval.
_Avoid_: Claim allowlist, administrator approval, nominee payment

**Settlement Asset**:
WETH, the asset paired with the Liquid Token in the Canonical Market and accumulated for downstream fee processing.
_Avoid_: Stock Reward, creator token

**Conversion Asset**:
USDC acquired from the WETH reward pot as the common intermediate for purchasing every asset in the Canonical Reward Set.
_Avoid_: Settlement Asset, Stock Reward

**Reward Epoch**:
A bounded conversion event that divides queued reward WETH equally among the four Reward Tracks and processes each budget through its own Sealed Route.
_Avoid_: Dividend period, guaranteed payout date

**Sealed Route**:
A fixed `WETH → USDC → Stock Reward` conversion path whose assets and reward destination cannot be redirected by its executor.
_Avoid_: Arbitrary swap, user-selected route

**Deferred Track Budget**:
The reserved WETH share of a Reward Track whose Sealed Route could not complete. It remains assigned to that track for a later retry and cannot be redistributed.
_Avoid_: Treasury balance, shared reward pot

**Keeper**:
The appointed executor that opens Reward Epochs and processes Sealed Routes without authority to redirect their assets or destinations.
_Avoid_: Fund manager, reward owner

**Pending Reward**:
A Stock Reward accrued to a Permanent Collectible's identity. It transfers with that collectible until claimed by its current owner and paid to that owner's wallet, rather than remaining with a previous owner.
_Avoid_: Owner balance, personal receivable

**Relic Pot**:
Pending Rewards reserved for a Basket Relic or Indicator Relic. It can accumulate before the relic is committed but becomes claimable only after Commitment.
_Avoid_: Treasury reserve, immediately claimable reward

**Unclaimed Track Pot**:
The ordinary 82.5% share accumulated while a Reward Track has no ordinary Permanent Collectibles. The first ordinary collectible committed to that track receives the entire accumulated pot, after which new rewards are shared by active tier weight.
_Avoid_: Relic Pot, treasury balance, equal retroactive distribution

**Canonical Market**:
The designated Liquid Token/WETH market whose WETH-side activity funds the collectible economy.
_Avoid_: Stock market, every secondary pool

**Historical Read Model**:
The project-owned, manifest-bound index of Canonical Market swaps/fees and protocol lifecycle
events. It persists a shared checkpoint, replays recent reorgs, and reports requested coverage as
complete, partial, or error. It is authoritative for historical presentation; direct block-pinned
RPC reads remain authoritative for current balances, roles, pauses, quotes, and pool state.
_Avoid_: Browser cache, bounded event window, public DEX website as source of truth

**Genesis Liquidity**:
The permanently locked, initially one-sided Canonical Market position containing all 4,444 Liquid Tokens and no WETH. Buyers supply its WETH as tokens enter circulation; there is no presale, treasury token allocation, or NFT mint sale.
_Avoid_: Team allocation, token sale, redeemable treasury inventory

**Protocol-Owned Liquidity**:
A permanently locked liquidity position owned by the protocol that deepens the Canonical Market and accrues its swap fees. Each liquidity cycle deposits queued WETH into a one-sided market range without first buying Liquid Tokens; the position cannot be removed or withdrawn.
_Avoid_: Price floor, treasury cash, guaranteed exit liquidity

**Trading Fee**:
The permanent 3% charge on WETH-side Canonical Market volume: 2% for Stock Rewards, 0.85% for Protocol-Owned Liquidity, and 0.15% for the creator.
_Avoid_: Tax revenue, dividend source

**Collecting Loop**:
The speculative game of trading Liquid Tokens, discovering Transient Collectibles, and deciding whether to make selected collectibles permanent in exchange for future Stock Rewards.
_Avoid_: Stock brokerage, savings product
