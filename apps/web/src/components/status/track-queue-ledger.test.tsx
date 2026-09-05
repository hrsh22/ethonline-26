import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrackQueueLedger } from "./track-queue-ledger";

describe("track queue ledger", () => {
  it("renders public queue amounts, deferred budgets, outcomes, and statuses", () => {
    const html = renderToStaticMarkup(
      <TrackQueueLedger
        ariaLabel="Reward Track WETH queues"
        emptyMessage="No queue data"
        trackOutcomes={{
          1: { latest: undefined },
          2: { latest: undefined },
          3: { latest: { explanation: "Retry remains available." } },
          4: { latest: undefined },
        }}
        trackQueues={[
          {
            track: "AAPLc",
            trackId: 1,
            wethFormatted: "0",
            deferred: false,
            status: "clear",
          },
          {
            track: "METAc",
            trackId: 3,
            wethFormatted: "5",
            deferred: true,
            status: "retryable",
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Reward Track WETH queues"');
    expect(html).toContain('role="table"');
    expect(html).toContain('role="columnheader"');
    expect(html).toContain('data-label="Queued WETH"');
    expect(html).toContain('data-label="Deferred Track Budget"');
    expect(html).toContain("AAPLc");
    expect(html).toContain("0 WETH");
    expect(html).toContain("METAc");
    expect(html).toContain("5 WETH");
    expect(html).toContain("Retry remains available.");
    expect(html).toContain("Retry available");
  });

  it("announces an empty queue through shared state feedback", () => {
    const html = renderToStaticMarkup(
      <TrackQueueLedger
        ariaLabel="Reward Track WETH queues"
        emptyMessage="No queue data"
        trackOutcomes={undefined}
        trackQueues={[]}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No queue activity");
    expect(html).toContain("No queue data");
  });
});
