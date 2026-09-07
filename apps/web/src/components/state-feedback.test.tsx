import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DisabledReason,
  StateFeedback,
  type StateFeedbackTone,
} from "./state-feedback";

const politeStates = [
  "loading",
  "empty",
  "blocked",
  "partial",
  "stale",
  "success",
  "notice",
] as const satisfies readonly StateFeedbackTone[];

describe("shared state feedback", () => {
  it.each(politeStates)(
    "announces %s feedback without stealing focus",
    (tone) => {
      const html = renderToStaticMarkup(
        <StateFeedback
          description="A safe next step is available."
          title="Current state"
          tone={tone}
        />,
      );

      expect(html).toContain(`data-state="${tone}"`);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('aria-atomic="true"');
      expect(html).toContain('aria-hidden="true"');
    },
  );

  it("announces errors assertively and keeps recovery actions adjacent", () => {
    const html = renderToStaticMarkup(
      <StateFeedback
        action={<button type="button">Try again</button>}
        description="The request did not complete. Try again."
        title="Request unavailable"
        tone="error"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("Error:");
  });

  it("renders an addressable reason next to a disabled action", () => {
    const html = renderToStaticMarkup(
      <>
        <button
          aria-describedby="funding-disabled-reason"
          disabled
          type="button"
        >
          Request funds
        </button>
        <DisabledReason id="funding-disabled-reason">
          Connect a wallet before requesting test funds.
        </DisabledReason>
      </>,
    );

    expect(html).toContain('aria-describedby="funding-disabled-reason"');
    expect(html).toContain('id="funding-disabled-reason"');
    expect(html).toContain('role="note"');
  });

  it("supports inverse operator surfaces without changing its semantics", () => {
    const feedbackHtml = renderToStaticMarkup(
      <StateFeedback
        description="Checking current onchain roles."
        surface="inverse"
        title="Verifying authority"
        tone="loading"
      />,
    );
    const reasonHtml = renderToStaticMarkup(
      <DisabledReason id="inverse-reason" surface="inverse">
        Wait for verification to finish.
      </DisabledReason>,
    );

    expect(feedbackHtml).toContain('data-surface="inverse"');
    expect(feedbackHtml).toContain('role="status"');
    expect(reasonHtml).toContain('data-surface="inverse"');
  });
});
