import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HealthCheckLedger } from "./health-check-ledger";

describe("health check ledger", () => {
  it("renders healthy, warning, and failing checks with exact evidence", () => {
    const html = renderToStaticMarkup(
      <HealthCheckLedger
        checks={[
          {
            id: "supply-invariant",
            status: "pass",
            severity: "critical",
            freshness: "fresh",
            observedBlock: 444n,
            expected: "4444",
            observed: "4444",
            explanation: "Supply and permanent backing reconcile.",
          },
          {
            id: "track:3",
            status: "fail",
            severity: "warning",
            freshness: "fresh",
            observedBlock: 444n,
            expected: "clear or executable",
            observed: "retryable deferred budget",
            explanation: "METAc needs an isolated retry.",
          },
          {
            id: "reward-solvency:METAc",
            status: "fail",
            severity: "critical",
            freshness: "fresh",
            observedBlock: 444n,
            expected: "balance >= 10",
            observed: "9",
            explanation: "The ledger is undercollateralized.",
          },
        ]}
        id="accounting-checks"
        title="Accounting checks"
      />,
    );

    expect(html).toContain('aria-labelledby="accounting-checks"');
    expect(html).toContain('data-check-state="healthy"');
    expect(html).toContain('data-check-state="warning"');
    expect(html).toContain('data-check-state="failing"');
    expect(html).toContain("Expected");
    expect(html).toContain("Observed");
    expect(html).toContain("Fresh");
    expect(html).toContain("Observed block 444");
    expect(html).toContain("METAc needs an isolated retry.");
  });
});
