import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TransactionStatus } from "./transaction-status";

describe("transaction status", () => {
  it("shows automatic receipt recovery without asking the collector to retry", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        automaticRecovery
        onRetry={vi.fn()}
        state={{
          status: "outcome-unknown",
          label: "Launch #42",
          hash: `0x${"12".repeat(32)}`,
          message: "RPC timeout",
        }}
      />,
    );
    expect(html).toContain("checking its outcome automatically");
    expect(html).toContain("View transaction");
    expect(html).not.toContain("Check submitted outcome");
    expect(html).not.toContain("RPC timeout");
  });

  it("announces a failed transaction assertively", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        onRetry={vi.fn()}
        state={{ status: "failed", label: "Launch", message: "Rejected" }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).not.toContain('aria-live="polite"');
  });

  it("announces a retriable transaction failure assertively", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        onRetry={vi.fn()}
        state={{
          status: "retriable",
          label: "Buy $FUEL",
          message: "The transaction can be tried again safely.",
        }}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("Try again");
  });

  it("presents an unknown submitted outcome as reconciliation, not replay", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        onRetry={vi.fn()}
        state={{
          status: "outcome-unknown",
          label: "Buy $FUEL",
          message:
            "The submitted transaction outcome has not been observed yet.",
          hash: `0x${"12".repeat(32)}`,
        }}
      />,
    );

    expect(html).toContain('data-status="outcome-unknown"');
    expect(html).toContain("Submitted outcome unknown");
    expect(html).toContain(
      "The submitted transaction outcome has not been observed yet.",
    );
    expect(html).toContain("Check submitted outcome");
    expect(html).toContain("View transaction");
    expect(html).not.toContain("Try again");
  });

  it("disables duplicate reconciliation while the submitted hash is being checked", () => {
    const html = renderToStaticMarkup(
      <TransactionStatus
        onRetry={vi.fn()}
        state={{
          status: "outcome-unknown",
          label: "Approve WETH for exchange",
          message: "The submitted outcome has not been observed yet.",
          hash: `0x${"12".repeat(32)}`,
          reconciling: true,
        }}
      />,
    );

    expect(html).toContain("Checking submitted outcome…");
    expect(html).toContain("disabled");
    expect(html).not.toContain(">Check submitted outcome<");
  });
});
