# Singapore operator and tokenized-stock claim gate

_Architecture research only; not legal advice._

## Conclusion

Singapore is a plausible provisional home for the testnet POC, but public materials do not establish that a Singapore company, resident, protocol vault, or keeper may acquire and distribute Coinbase Tokenized Stocks. The POC should reproduce the complete economic and state flow with four valueless mock stock tokens on Base Sepolia. Real B20 acquisition, mainnet fee collection, and enforceable stock rewards should remain disabled until both Coinbase and Singapore counsel confirm the proposed flow.

Eligibility, KYC, and operational implementation are explicitly operator-owned concerns outside the protocol specification. The research below records constraints for the operator; it does not add an identity subsystem or nominee-claim flow to the protocol.

## Coinbase and B20 eligibility

Coinbase describes the products as digital securities offered under Regulation S to eligible users outside the United States, but says they are unavailable in some other restricted markets without publishing a country list that affirmatively includes Singapore. Primary minting and redemption are limited to KYC-onboarded institutional Authorized Participants; ordinary users acquire tokens through secondary markets. [Coinbase Tokenize](https://www.coinbase.com/tokenize), [Base B20 integration guide](https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base)

The prospectus does not name Singapore as prohibited, but that omission is not approval. It requires every acquisition and DeFi transfer to comply with applicable local law. A wallet can possess an unvested token while Coinbase's tokenisation entity retains legal registration and full rights until the holder satisfies changing Vesting Conditions. Those conditions can include KYC/AML, proof of wallet control, sanctions and jurisdiction checks; Coinbase may restrict or freeze addresses. [Official AAPLc prospectus, sections 12 and 14](https://assets.ctfassets.net/o10es7wu5gm1/6t7LV7NUfghwRYjZpReFYH/6e08881544b683a4c886aaa809c2d51a/Coinbase_Onchain_SPV_Ltd_-_Prospectus__AAPL__-_FSRA_VERSION.pdf)

Consequently, a successful ERC-20 transfer is not proof that the recipient is legally eligible, vested, or able to redeem. Production requires written confirmation that Singapore persons and the protocol's contracts can participate in the intended reward-distribution flow.

## Singapore classification risks

The Securities and Futures Act defines dealing in capital-markets products broadly enough to include making, offering, inducing, or arranging an acquisition or disposal. A Singapore operator whose keeper repeatedly converts protocol fees into stock securities and assigns them to users could therefore be conducting a regulated activity. Carrying on a regulated activity normally requires a capital-markets-services licence unless an exemption applies. [SFA Second Schedule](https://sso.agc.gov.sg/Act/SFA2001?ProvIds=Sc2-), [SFA section 82](https://sso.agc.gov.sg/Act/SFA2001?ProvIds=P14-)

The combined token/NFT arrangement also presents a credible collective-investment-scheme question: participants lack day-to-day control, fee proceeds are pooled, stock property is managed centrally or by protocol contracts, and holders receive allocations arising from that property. If classified as a CIS, fund-management, custody, scheme-authorisation, prospectus, and promotion requirements may follow. [SFA collective-investment-scheme definition](https://sso.agc.gov.sg/Act/SFA2001?WholeDoc=1)

Calling stock transfers “free rewards” is not conclusive. Singapore has limited no-consideration offer exemptions, but acquiring and burning the Liquid Token may itself be consideration, and an offer exemption would not automatically remove dealing, fund-management, custody, or market-operator obligations. [SFA sections 272 and 302A](https://sso.agc.gov.sg/Act/SFA2001?WholeDoc=1)

Automation and immutable contracts do not remove these risks where a Singapore team deploys, promotes, administers, chooses reward assets, controls a keeper, or retains upgrade and pause powers. Operating only for foreign users may also engage Singapore's Financial Services and Markets Act provisions for digital-token services provided outside Singapore. [FSMA Part 9](https://sso.agc.gov.sg/Act/FSMA2022?ProvIds=P19-)

## POC boundary

The pre-counsel POC should use:

- Base Sepolia or a local chain only;
- four fictitious `MOCK-A`, `MOCK-B`, `MOCK-C`, and `MOCK-D` reward tokens rather than Coinbase contracts or stock trademarks;
- faucet-only ETH, WETH, and USDC with no real-value conversion;
- no public sale, redemption, cash-out, or enforceable financial claim; and
- explicit simulation language rather than return, yield, dividend, or investment marketing.

It should still test the complete product mechanics: whole-unit NFT materialisation and dissolution, irreversible Commitment, fee queues, four isolated conversion routes, reward weights, Relic Pots, deferred budgets, policy rejection, pauses, failed swaps, pending allocations, and failed claims.

## Eventual claim-gate requirements

A production claim should require a short-lived, wallet-specific eligibility credential covering KYC/KYB, beneficial owners, residency and current location, non-US status, sanctions and issuer restrictions, proof of destination-wallet control, and acceptance of current Coinbase terms. The claim must recheck the token's live policy and simulate the transfer before changing accounting state; it becomes claimed only after the transfer succeeds. Failed or ineligible claims remain pending rather than being confiscated or redirected.

Personal data should remain offchain. Only a signed, expiring, revocable eligibility proof and minimal status should be exposed to the contracts. The treasury, keeper, routers, and destination must be screened, not just the end user.

A claim-only gate may be insufficient if the transferable Permanent Collectible itself represents an attached right to accumulated securities. Singapore counsel must determine whether eligibility must also constrain Commitment, accrual, or NFT transfers.

## Required confirmations before mainnet

1. Coinbase/SPV confirmation that Singapore persons, the reward vault, keeper, and protocol-level promotional distributions are permitted and can satisfy applicable Vesting Conditions.
2. Singapore classification of the Liquid Token, Permanent Collectible, attached Pending Rewards, and combined arrangement.
3. Advice on dealing/arranging, fund management, custody, organised-market, prospectus, promotion, financial-advice, and gambling-law exposure.
4. Identification of any required CMS, FSMA, or other licence, exemption, or licensed operating partner.
5. Permitted marketing language and whether the product may be offered to retail users.
