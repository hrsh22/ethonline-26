#!/usr/bin/env bash

set -euo pipefail

# Foundry imports these direct dependencies from upstream repositories. Avoid a
# recursive checkout: unrelated test-only trees (notably Optimism) are large
# enough to exhaust the shortest CI job before its tests begin.
git -C packages/contracts/lib/v4-core submodule update --init --depth 1 -- \
  lib/forge-std \
  lib/openzeppelin-contracts \
  lib/solmate

git -C packages/contracts/lib/continuous-clearing-auction submodule update --init --depth 1 -- \
  lib/blocknumberish \
  lib/liquidity-launcher \
  lib/openzeppelin-contracts \
  lib/permit2 \
  lib/solady \
  lib/v4-periphery

# Upstream pins this public repository with an SSH URL. CI has no deploy key,
# so use the equivalent HTTPS transport for the nested checkout.
git -C packages/contracts/lib/liquidity-launcher config \
  submodule.lib/openzeppelin-contracts.url \
  https://github.com/OpenZeppelin/openzeppelin-contracts.git

git -C packages/contracts/lib/liquidity-launcher submodule update --init --depth 1 -- \
  lib/blocknumberish \
  lib/forge-std \
  lib/openzeppelin-contracts \
  lib/permit2 \
  lib/solady \
  lib/uerc20-factory \
  lib/v4-core \
  lib/v4-periphery
