"use client";

import {
  formatEpochTime,
  formatObserved,
  type HealthSnapshot,
  type ProtocolClient,
} from "@/components/admin/admin-console-context";
import { Badge } from "@/components/ui/badge";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { applicationCopy } from "@/lib/identity";

/**
 * The reward-epoch instrument: how many epochs have opened, when the last one
 * did, when the next one may, and the block every reading above was taken at.
 */
export function AdminEpochBoard({
  health,
  protocol,
}: {
  readonly health: HealthSnapshot;
  readonly protocol: ProtocolClient;
}) {
  return (
    <Panel
      className="laptop:col-span-6"
      meta={
        <Badge dot tone={protocol.deploymentAvailable ? "success" : "warning"}>
          {protocol.deploymentAvailable
            ? applicationCopy.shell.networkReady
            : applicationCopy.shell.deploymentPending}
        </Badge>
      }
      title={applicationCopy.operations.epoch}
    >
      <DataList>
        <DataRow
          label={applicationCopy.operations.epochCount}
          tone="live"
          value={formatObserved(health?.operations.rewardEpochCount)}
        />
        <DataRow
          label={applicationCopy.operations.lastEpoch}
          value={formatEpochTime(
            health?.operations.lastRewardEpochAt,
            applicationCopy.operations.readyNow,
          )}
        />
        <DataRow
          label={applicationCopy.operations.nextEpoch}
          value={formatEpochTime(
            health?.operations.nextRewardEpochAt,
            applicationCopy.operations.readyNow,
          )}
        />
        <DataRow
          label={applicationCopy.home.observedBlock}
          value={
            health?.health.observedBlock.toString() ??
            applicationCopy.common.notObserved
          }
        />
      </DataList>
    </Panel>
  );
}
