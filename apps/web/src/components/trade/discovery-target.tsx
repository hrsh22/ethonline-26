"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress } from "viem";
import { protocolAbis } from "@orbit/protocol/contracts";
import { Button } from "@/components/ui/button";
import { protocolDeploymentManifest } from "@/lib/deployment";
import { discoveryTargetOutput } from "@/lib/discovery-target";
import { createProtocolReadClient } from "@/lib/wagmi";
import type { Address } from "viem";

export function DiscoveryTarget({
  address,
  balance,
  disabled,
  onAmount,
}: {
  readonly address: Address;
  readonly balance: bigint;
  readonly disabled: boolean;
  readonly onAmount: (amount: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scope = `${address}:${balance}:${disabled}`;
  const current = useRef<string | undefined>(scope);
  useEffect(() => {
    current.current = scope;
    return () => {
      current.current = undefined;
    };
  }, [scope]);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || pending}
        onClick={async () => {
          if (protocolDeploymentManifest === undefined) return;
          const requestScope = scope;
          setPending(true);
          setError("");
          try {
            const reader = createProtocolReadClient(
              AbortSignal.timeout(15_000),
            );
            const { result } = await reader.simulateContract({
              address: getAddress(
                protocolDeploymentManifest.contracts.canonicalRouter,
              ),
              abi: protocolAbis.canonicalRouter,
              functionName: "quoteExactOutput",
              args: [false, discoveryTargetOutput(balance)],
              account: address,
            });
            if (current.current === requestScope)
              onAmount(formatUnits(result[0] + 1n, 18));
          } catch {
            if (current.current === requestScope)
              setError(
                "Couldn’t calculate the target. Enter an amount or try again.",
              );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Calculating…" : "Enough for 1 Discovery"}
      </Button>
      {error ? (
        <p role="status" className="text-body-sm text-ink-soft">
          {error}
        </p>
      ) : null}
    </div>
  );
}
