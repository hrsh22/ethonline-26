interface CollectibleExplorerInput {
  readonly chainId: number;
  readonly contract: string;
  readonly identityId?: number | undefined;
}

export interface CollectibleExplorerUrls {
  readonly collection: string;
  readonly identity: string | undefined;
}

const explorers: Partial<
  Record<
    number,
    {
      readonly basescan: string;
      readonly blockscout: string;
    }
  >
> = {
  8_453: {
    basescan: "https://basescan.org",
    blockscout: "https://base.blockscout.com",
  },
  84_532: {
    basescan: "https://sepolia.basescan.org",
    blockscout: "https://base-sepolia.blockscout.com",
  },
};

export const collectibleExplorerUrls = ({
  chainId,
  contract,
  identityId,
}: CollectibleExplorerInput): CollectibleExplorerUrls | undefined => {
  const explorer = explorers[chainId];
  if (explorer === undefined) return undefined;
  return {
    collection: `${explorer.blockscout}/token/${contract}`,
    identity:
      identityId === undefined
        ? undefined
        : `${explorer.basescan}/nft/${contract}/${identityId}`,
  };
};
