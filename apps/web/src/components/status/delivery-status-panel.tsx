"use client";

import { Panel } from "@/components/ui/panel";
import {
  useDeliveryStatus,
  type DeliveryCondition,
} from "@/hooks/use-delivery-status";

const descriptions: Record<DeliveryCondition, string> = {
  running:
    "The delivery service is online. A Discovery can still be waiting for randomness or onchain confirmation.",
  stopped:
    "Automatic delivery is stopped. Your pending Discovery remains recorded; no wallet retry will restart the service.",
  checking:
    "The service is checking work but automatic delivery is not enabled.",
  offline:
    "The delivery service is offline. Pending Discoveries remain recorded until processing resumes.",
  delayed:
    "The service reported an unsuccessful processing run. Pending work remains recorded for recovery.",
  unknown:
    "Current delivery-service status could not be verified. This does not establish whether your Discovery has finished.",
};

export function DeliveryStatusPanel() {
  const delivery = useDeliveryStatus();
  return (
    <Panel className="mt-3" title="Collectible delivery">
      <p className="font-semibold">Delivery {delivery.state}</p>
      <p className="mt-1 text-body text-ink-soft">
        {descriptions[delivery.state]}
      </p>
      {delivery.data === undefined ? null : (
        <dl className="mt-3 grid gap-2 text-body-sm">
          <div>
            <dt className="text-ink-soft">Saved processing setting</dt>
            <dd>
              {delivery.data.policy.mode === "live"
                ? "Automatic"
                : delivery.data.policy.mode === "dry-run"
                  ? "Checks only"
                  : "Stopped"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Service heartbeat</dt>
            <dd>
              {delivery.data.liveness.heartbeatAt === undefined ? (
                "No heartbeat observed"
              ) : (
                <time
                  dateTime={new Date(
                    delivery.data.liveness.heartbeatAt,
                  ).toISOString()}
                >
                  {new Date(
                    delivery.data.liveness.heartbeatAt,
                  ).toLocaleString()}
                </time>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">Status checked</dt>
            <dd>
              <time dateTime={new Date(delivery.data.observedAt).toISOString()}>
                {new Date(delivery.data.observedAt).toLocaleString()}
              </time>
            </dd>
          </div>
        </dl>
      )}
    </Panel>
  );
}
