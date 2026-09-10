# QUOTRONS rarity and Relic distribution provenance

This note separates V1 launch mechanics from V2 migration. It uses only QUOTRONS' official repository and website, verified contract source, and Robinhood Chain explorer records.

## Conclusion

- **V1 launch did not give rare IDs or the four Relics a separate distribution path.** The constructor minted all 4,444 fungible units to the deployer while making that address ERC-721-transfer-exempt. Ten launch transactions then placed effectively the entire supply into ten exempt liquidity pools, approximately 444.4 units per pool. Pool seeding therefore created no collectible owners.
- **Traits were fixed by ID; ownership was drawn at acquisition.** A recipient crossing a whole-token boundary caused the core contract to select an available ID through its global virtual Fisher–Yates draw. The verified source has no reserved-ID, team-mint, or Relic-airdrop branch.
- **The draw was pseudorandom, not a cryptographically fair lottery.** V1 derived its draw index from `block.prevrandao`, `block.timestamp`, the recipient, and an incrementing nonce. “Random” below means that contract mechanism.
- **V2 usually preserved identity rather than rerolling it.** Its published base mapping keeps exact IDs for 1,425 dark and 2,001 hardwired V1 terminals. Restitution is the exception: 227 rows recover the original ID, 132 receive a same-track/same-tier replacement, and one receives a same-tier cross-track replacement. Fractional holdings had no individual terminal ID to preserve.
- **All four Relics were discovered through market-triggered V1 materialization and later migrated under the same IDs.** The first receiving wallets are public, but evidence gathered here cannot establish whether any wallet was team-affiliated.

## A. V1 genesis, liquidity, and discovery

The verified [`Quotron404` core contract](https://robinhoodchain.blockscout.com/address/0x40686524e56AfF0F1446958725dCF6e6dA5381E6?tab=contract) constructor:

1. set `poolSize = 4444`;
2. minted `4444 * 1e18` fungible units to the deployer; and
3. made the deployer ERC-721-transfer-exempt, so this treasury balance did not materialize collectible IDs.

The verified [V1 seeder](https://robinhoodchain.blockscout.com/address/0xe2EaE8F7eB81Bb4a5971BB65847632bc6Be6cf18?tab=contract) is add-only: it seeds positions but exposes no liquidity removal or withdrawal path. The ten launch receipts show QUOTRON transfers of approximately 444.4 units apiece into ten pools. Their exact aggregate is `4,443.999999999999999932` QUOTRON, leaving 68 wei of the 4,444-unit supply as rounding dust. The ten primary transaction records are [1](https://robinhoodchain.blockscout.com/tx/0x008e1a1b66c0d06169c15a7f4913aa95c62afc5195f633587f3be5e8da62cae4), [2](https://robinhoodchain.blockscout.com/tx/0x95250597f624c49170199b8b86bb5e2e82d66e41e0d7d6dcad61d2643efb8f81), [3](https://robinhoodchain.blockscout.com/tx/0x2e468cc0c69f0e6e81de7fb208efd8cd2ab81ec1d44968fc564a17150a5a9d5a), [4](https://robinhoodchain.blockscout.com/tx/0xe3757786bc84133451afab76989c2a67f9063bd77f01452850fc6ef593895bf2), [5](https://robinhoodchain.blockscout.com/tx/0xfe8d30fe500aff21107cd64c6994b497d3c22d52cd5d3b66632c7c6a954cdba4), [6](https://robinhoodchain.blockscout.com/tx/0x9bc769f196d6e24c8095bd827af2e48388acac574fce6b371db8610df72e408b), [7](https://robinhoodchain.blockscout.com/tx/0x7d4686c4ca9035316b0829f2a8ce27e383025f460aae80adaa46e844bb5ca351), [8](https://robinhoodchain.blockscout.com/tx/0x9dd8fd96e508388a6ba0bbe968048c9b7f96cf7c3e5bc54b5d9ef268ef6d64fd), [9](https://robinhoodchain.blockscout.com/tx/0x7b615f03876156a7c33539ec6ed050977a7781c9010d3915e2fa70d7fabd66db), and [10](https://robinhoodchain.blockscout.com/tx/0x6fe2de3b90e5ab220d14e9f173fed9867f443cd1437a71cf2c8aa4a50d94465c).

The core and PoolManager were exempt from collectible synchronization. A collectible was first assigned only when a non-exempt wallet gained another whole fungible unit. `_syncUp` called `_draw`, which selected one of the available IDs in a virtual Fisher–Yates pool. If the holder later dropped below that whole-unit balance, the most recently materialized dark ID dissolved and returned to the available pool. Consequently:

- liquidity allocation was fungible and equal across the ten launch pools;
- collectible identity allocation happened later, at user acquisition;
- every unclaimed ordinary tier and every Relic participated in the same global ID pool; and
- a Relic could be dissolved and discovered again until hardwired.

## B. Predetermined traits versus random ownership

The core stored an immutable `assignmentHash`; its verified source identifies the committed assignment seed as `44440707`. The currently readable V1 hash is `0xd385f0257ffb1ca15f9fb7bafba1896d1c0af0cc413d552e46145f1b36200fd0`. This establishes that metadata such as track and rarity was predetermined for each numeric ID, while the wallet receiving an available ID was selected during materialization.

The [official collection documentation](https://www.quotrons.cash/llms-full.txt) gives the ordinary distribution as 2,450 Tier I, 1,330 Tier II, 530 Tier III, and 130 top-tier terminals, plus the four Relics at IDs 4441–4444. Each of the ten ordinary tracks has the same 245/133/53/13 tier composition. The verified V1 source contains no code that removes a rare ID or Relic from the global pool for a reserved mint, airdrop, or team allocation.

The draw input was:

```solidity
keccak256(abi.encodePacked(block.prevrandao, block.timestamp, forWhom, ++_drawNonce))
```

modulo the remaining pool size. That makes the allocation deterministic onchain once transaction and block inputs are fixed, but it does not prove unpredictability against block builders or sophisticated buyers. The sources reviewed also do **not** establish when, relative to the first sale, the full ID-to-trait assignment file became publicly readable. They establish a precommitment, not its exact reveal time.

## C. V2 migration: preserved IDs and defined exceptions

The official [snapshot policy](https://github.com/mavrkofficial/quotrons-v1-post-mortem/blob/main/docs/02-migration/snapshot-policy.md) used block `34,984,482` for liquid/dark/fractional eligibility and block `35,337,540` to follow later ownership transfers of already-hardwired terminals. According to the official [terminal-mapping report](https://github.com/mavrkofficial/quotrons-v1-post-mortem/blob/main/docs/02-migration/terminal-mapping.md):

- all 1,425 base dark rows preserve `v1_terminal_id == v2_terminal_id` and liquid-cutoff ownership;
- all 2,001 base hardwired rows preserve `v1_terminal_id == v2_terminal_id`, hardwired state, and the later hardwired-cutoff owner;
- 227 restitution rows recover the original ID;
- 132 restitution rows receive a same-track/same-tier replacement ID; and
- one restitution row receives a same-tier, cross-track replacement.

The [published migration data](https://github.com/mavrkofficial/quotrons-v1-post-mortem/tree/main/data/migration) and website describe a zero-action V2 delivery. It did not take or mutate the V1 NFT. The verified [V2 migrator](https://robinhoodchain.blockscout.com/address/0x205E13e6Ec07baa4eD1c57d677DE9FeE1C88Cd6D?tab=contract) makes the preservation rule executable: an owner-operated `distributeBatch` must prove each leaf against its immutable Merkle root, and a hardwired leaf requires `amount == 0` and `v1Id == v2Id` before `migrateHardwired(account, v2Id)`. Distribution finalized onchain on 2026-08-13 in [this transaction](https://robinhoodchain.blockscout.com/tx/0x6b8093a01072a1ed4bf26df6a8a6bdfd5eec874e6dfee788aa1f705efc85f01d). Thus “V2 preserved IDs” is exact for the 3,426 base terminal rows, but should not be generalized to all restitution or fractional balances.

All four Relics appear in the official [`terminal-id-mapping.csv`](https://github.com/mavrkofficial/quotrons-v1-post-mortem/blob/main/data/migration/terminal-id-mapping.csv) as hardwired, exact-ID mappings:

| Relic            | V1 ID → V2 ID | V2 recipient from published mapping          | First V2 distribution transaction                                                                                            |
| ---------------- | ------------: | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Semaphore        |   4441 → 4441 | `0xb4A22D79110Bd50342DcdC15079f966e883e7f0a` | [`0x4c4c…e8e2`](https://robinhoodchain.blockscout.com/tx/0x4c4ca28679522fb8fb35091f996348cc34ea627c364a7fa750527efe66fae8e2) |
| Universal Ticker |   4442 → 4442 | `0x516aC603F68B405a4e382F08Bd5646bB07a29db3` | [`0xbe64…3fab`](https://robinhoodchain.blockscout.com/tx/0xbe64df6bfff17c215cbcf2a81d69548baac94b6b2da189b5c3591ea24c8d3fab) |
| Trans-Lux        |   4443 → 4443 | `0x365F6bC10224AB1dd38FDE4a8EF15c0aC66070eA` | [`0x934b…e245`](https://robinhoodchain.blockscout.com/tx/0x934b78da8fcbcaf8de6e69300e025b4781d60a6bff60f2bd14281501d11de245) |
| Gold Indicator   |   4444 → 4444 | `0xb4A22D79110Bd50342DcdC15079f966e883e7f0a` | [`0x4c4c…e8e2`](https://robinhoodchain.blockscout.com/tx/0x4c4ca28679522fb8fb35091f996348cc34ea627c364a7fa750527efe66fae8e2) |

This was preservation of V1 cutoff ownership, not a new V2 rarity lottery.

## D. The four Relics' first V1 owners

The V1 mirror's first mint (`Transfer` from the zero address) for each Relic is shown below. Each cited transaction was initiated by the receiving wallet, carried nonzero native value into a market/router contract, and its receipt shows QUOTRON moving out of the official PoolManager before the mirror mint. That is evidence of ordinary market-triggered materialization rather than a deployer mint or airdrop.

| Relic                  | First recorded V1 owner                      | Block / UTC                      | First materialization transaction                                                                                            |
| ---------------------- | -------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Semaphore #4441        | `0x7AE604Bb2BA6fB5Bb3AcecD7ccC25d19d280A434` | 34,691,194 / 2026-08-12 17:00:01 | [`0xdcab…d088`](https://robinhoodchain.blockscout.com/tx/0xdcabfb4f7d56c5768a649ac42730f3d2b6564a5066b867b4a97bae1e88abd088) |
| Universal Ticker #4442 | `0x0Eb927539651159549cefB2c3dF32775446c9D78` | 34,691,508 / 2026-08-12 17:00:35 | [`0xff7e…2647`](https://robinhoodchain.blockscout.com/tx/0xff7e1c10224114c396b6d125c6056617b56583af073ec7d8e88cd50d3c6d2647) |
| Trans-Lux #4443        | `0x55F3422138e9FED0Bd81351bFf66c882550002E8` | 34,691,189 / 2026-08-12 17:00:00 | [`0xaea3…b357`](https://robinhoodchain.blockscout.com/tx/0xaea3066da72088f9be6c2046064bbe2420172061e4ad472bf199a42c0cafb357) |
| Gold Indicator #4444   | `0xb61d1E5Fcb927FDB04D719Bd2ccB1dFf688f7Cf9` | 34,691,195 / 2026-08-12 17:00:01 | [`0xb7ea…27db`](https://robinhoodchain.blockscout.com/tx/0xb7ea6871739f8f011d056fb2fad7e917061d9389f6d75c76fba5b35608c527db) |

V1 opened at block `34,691,180`, so all four first materializations occurred within 36 seconds of launch. V1 did have a six-hour launch-fee window—3% for allowlisted buyers, 10% for 100 reduced-fee spots, and 40% for other buyers—but it did not reserve collectible IDs for those groups. The four first-Relic receipts recorded hook fees of 40% for IDs 4441, 4443, and 4444, and 10% for ID 4442; none used the 3% allowlisted tier. [Verified V1 floor hook and fee library](https://robinhoodchain.blockscout.com/address/0x5A7D914597476393794E100dDD8b70f8c3f570CC?tab=contract)

All four were subsequently dissolved at least once and returned to the draw pool before their eventual V1 hardwiring. This explains why the first owner above differs from the later V2 recipient. The complete primary transfer histories are available from the explorer for [#4441](https://robinhoodchain.blockscout.com/api/v2/tokens/0xbde7BEc47cbFc689e5E952B6cdD113A500abcd83/instances/4441/transfers), [#4442](https://robinhoodchain.blockscout.com/api/v2/tokens/0xbde7BEc47cbFc689e5E952B6cdD113A500abcd83/instances/4442/transfers), [#4443](https://robinhoodchain.blockscout.com/api/v2/tokens/0xbde7BEc47cbFc689e5E952B6cdD113A500abcd83/instances/4443/transfers), and [#4444](https://robinhoodchain.blockscout.com/api/v2/tokens/0xbde7BEc47cbFc689e5E952B6cdD113A500abcd83/instances/4444/transfers).

## What remains unknown

- Onchain addresses do not identify their human controllers. The first materialization route disproves a direct reserved mint/airdrop, but does not prove that no first-owner wallet was affiliated with the team.
- The reviewed primary sources do not timestamp public disclosure of the complete assignment table precisely enough to prove whether buyers knew the four Relic IDs before the first market transactions.
- The block-data draw is observable and influenceable in ways a secure randomness system should not be; the chain record proves the implemented algorithm, not economic fairness.

## Primary source index

- [Official QUOTRONS full documentation](https://www.quotrons.cash/llms-full.txt)
- [Verified V1 core contract](https://robinhoodchain.blockscout.com/address/0x40686524e56AfF0F1446958725dCF6e6dA5381E6?tab=contract)
- [Verified V1 mirror](https://robinhoodchain.blockscout.com/address/0xbde7BEc47cbFc689e5E952B6cdD113A500abcd83?tab=contract)
- [Verified V1 liquidity seeder](https://robinhoodchain.blockscout.com/address/0xe2EaE8F7eB81Bb4a5971BB65847632bc6Be6cf18?tab=contract)
- [Official V1 post-mortem repository](https://github.com/mavrkofficial/quotrons-v1-post-mortem)
- [Migration snapshot policy](https://github.com/mavrkofficial/quotrons-v1-post-mortem/blob/main/docs/02-migration/snapshot-policy.md)
- [Terminal-mapping report and data](https://github.com/mavrkofficial/quotrons-v1-post-mortem/blob/main/docs/02-migration/terminal-mapping.md)
