"use client";

import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";

import type {
  HealthSnapshot,
  ProtocolClient,
} from "@/components/admin/admin-console-context";
import { Badge } from "@/components/ui/badge";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { Address, Unavailable } from "@/components/ui/value";
import { applicationCopy, identity } from "@/lib/identity";

const consoleRoleLabels = {
  "liquid-token-owner": applicationCopy.operations.liquidTokenOwner,
  "reward-ledger-owner": applicationCopy.operations.rewardsOwner,
  "converter-owner": applicationCopy.operations.converterOwner,
  "liquidity-owner": applicationCopy.operations.liquidityOwner,
  guardian: applicationCopy.operations.guardian,
  recovery: `${applicationCopy.operations.recovery} signer`,
  keeper: applicationCopy.operations.keeper,
  "liquidity-executor": applicationCopy.operations.executor,
  creator: identity.terms.creator,
} as const satisfies Readonly<Record<AdminConsoleRoleId, string>>;

/**
 * Names the connected authority and lights up exactly the capabilities the
 * authenticated session holds. A frozen wallet is stated rather than inferred:
 * an unread freeze flag is unavailable, never "not frozen".
 */
export function AdminCapabilityConsole({
  health,
  protocol,
  roles,
}: {
  readonly health: HealthSnapshot;
  readonly protocol: ProtocolClient;
  readonly roles: readonly AdminConsoleRoleId[];
}) {
  const frozen = health?.connectedWalletFrozen;
  return (
    <Panel
      className="laptop:col-span-6"
      meta={applicationCopy.operations.capabilities}
      title={applicationCopy.operations.connectedAuthority}
    >
      <DataList>
        <DataRow
          label={applicationCopy.operations.connectedAuthority}
          value={
            protocol.address === undefined ? (
              applicationCopy.operations.ordinaryWallet
            ) : (
              <Address value={protocol.address} />
            )
          }
        />
        <DataRow
          label={applicationCopy.operations.walletState}
          value={
            frozen === undefined ? (
              <Unavailable reason={applicationCopy.common.notObserved} />
            ) : (
              <Badge dot tone={frozen ? "danger" : "success"}>
                {frozen
                  ? applicationCopy.operations.frozen
                  : applicationCopy.operations.notFrozen}
              </Badge>
            )
          }
        />
        {roles.map((role) => (
          <DataRow
            key={role}
            label={consoleRoleLabels[role]}
            value={
              <Badge tone="live">
                {applicationCopy.operations.capabilityHeld}
              </Badge>
            }
          />
        ))}
      </DataList>
    </Panel>
  );
}
