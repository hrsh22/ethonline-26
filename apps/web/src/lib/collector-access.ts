export type CollectorAccessState =
  "disconnected" | "wrong-network" | "deployment-pending" | "ready";

type CollectorAccessInput = {
  readonly connected: boolean;
  readonly chainId: number | undefined;
  readonly deploymentAvailable: boolean;
  readonly expectedChainId: number;
};

export const getCollectorAccessState = ({
  connected,
  chainId,
  deploymentAvailable,
  expectedChainId,
}: CollectorAccessInput): CollectorAccessState => {
  if (!connected) return "disconnected";
  if (chainId !== expectedChainId) return "wrong-network";
  if (!deploymentAvailable) return "deployment-pending";
  return "ready";
};
