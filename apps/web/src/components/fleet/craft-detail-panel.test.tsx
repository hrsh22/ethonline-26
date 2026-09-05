import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const protocolState = vi.hoisted(() => ({
  protocol: undefined as unknown,
}));
const collectibleState = vi.hoisted(() => ({
  read: {
    data: undefined,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  } as {
    data: unknown;
    isError: boolean;
    isPending: boolean;
    refetch: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@/providers/protocol-client-provider", () => ({
  useProtocolClient: () => protocolState.protocol,
}));
vi.mock("@/hooks/use-collectible-read", () => ({
  useCollectibleRead: () => collectibleState.read,
}));

import { CraftDetailPanel } from "./craft-detail-panel";

const source = readFileSync(
  new URL("./craft-detail-panel.tsx", import.meta.url),
  "utf8",
);

const craft = {
  identityId: 42,
  stateLabel: "Grounded Craft",
  rarityTier: "Common",
  rewardTrack: "AAPLc",
  rewardWeight: 1,
  specialKind: "None",
  claimEligible: true,
  pendingRewards: [{ track: "AAPLc", rawTokenUnits: 1n }],
};

const protocol = (state: "transient" | "permanent") => ({
  accessState: "ready" as const,
  address: "0x0000000000000000000000000000000000000042" as const,
  execute: vi.fn(),
  retry: vi.fn(),
  transaction: { status: "simulated" as const, label: "Buy $FUEL" },
  refresh: vi.fn(),
  walletSynchronizing: false,
  walletRead: {
    status: "loaded" as const,
    snapshot: {
      liquidToken: { formatted: "2", rawWei: 2_000_000_000_000_000_000n },
      collectibles: {
        transient: state === "transient" ? [craft] : [],
        permanent: state === "permanent" ? [craft] : [],
        permanentHoldingsStatus: "complete" as const,
      },
    },
  },
});

describe("collectible transaction controls", () => {
  beforeEach(() => {
    collectibleState.read = {
      data: undefined,
      isError: false,
      isPending: false,
      refetch: vi.fn(),
    };
  });

  it.each([
    ["transient", "Review Launch"],
    ["permanent", "Claim eligible rewards"],
  ] as const)(
    "disables the %s collectible action while another transaction is in flight",
    (state, label) => {
      protocolState.protocol = protocol(state);

      const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

      const button = new RegExp(`<button(?<attributes>[^>]*)>${label}`).exec(
        html,
      );
      expect(button?.groups?.attributes).toContain('disabled=""');
      const reasonId = /aria-describedby="(?<id>[^"]+)"/u.exec(
        button?.groups?.attributes ?? "",
      )?.groups?.id;
      expect(reasonId).toBeDefined();
      expect(html).toContain(`id="${reasonId}"`);
      expect(html).toContain('role="note"');
    },
  );

  it("does not offer a zero-value claim for a permanent identity", () => {
    const permanentProtocol = protocol("permanent");
    permanentProtocol.walletRead.snapshot.collectibles.permanent = [
      {
        ...craft,
        pendingRewards: [{ track: "AAPLc", rawTokenUnits: 0n }],
      },
    ];
    protocolState.protocol = permanentProtocol;

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    expect(html).not.toContain("Claim eligible rewards");
  });

  it.each([
    [
      "transient",
      "Only the current owner can Launch or transfer this Grounded Craft.",
      "claim attached rewards",
    ],
    [
      "permanent",
      "Only the current owner can transfer this Orbiter or claim attached rewards.",
      "can Launch",
    ],
  ] as const)(
    "describes only the owner actions available for a %s identity",
    (state, expected, unavailableAction) => {
      protocolState.protocol = protocol(state);

      const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

      expect(html).toContain(expected);
      expect(html).not.toContain(unavailableAction);
    },
  );

  it("blocks the launch review when the wallet cannot afford the burn", () => {
    const poor = protocol("transient");
    poor.transaction = { status: "idle" as const, label: "" } as never;
    poor.walletRead.snapshot.liquidToken = {
      formatted: "0.7242",
      rawWei: 724_200_000_000_000_000n,
    };
    protocolState.protocol = poor;

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    // The review used to open for any wallet; one holding less than the one
    // whole token the commitment burns learned that only from the reverted
    // transaction.
    const button = /<button(?<attributes>[^>]*)>Review Launch/u.exec(html);
    expect(button?.groups?.attributes).toContain('disabled=""');
    expect(html).toContain("holds only 0.7242");
  });

  it("keeps the launch review open to a wallet holding the whole token", () => {
    const funded = protocol("transient");
    funded.transaction = { status: "idle" as const, label: "" } as never;
    protocolState.protocol = funded;

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    const button = /<button(?<attributes>[^>]*)>Review Launch/u.exec(html);
    expect(button?.groups?.attributes).not.toContain('disabled=""');
    // The dialog itself states what the wallet holds beside the warning about
    // what the commitment burns. Portal content does not reach static markup,
    // so the wiring is asserted at the source like the confirmation action.
    expect(source).toMatch(
      /border-\[var\(--status-warning-text\)\][\s\S]*?launch\.fuelBalance\(fuelBalance\)/u,
    );
  });

  it("does not offer Launch again while the confirmed wallet snapshot catches up", () => {
    const synchronizing = protocol("transient");
    synchronizing.transaction = {
      status: "confirmed" as const,
      label: "Launch Grounded Craft",
      hash: `0x${"1".repeat(64)}`,
    } as never;
    synchronizing.walletSynchronizing = true;
    protocolState.protocol = synchronizing;

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    expect(html).not.toContain("Review Launch");
    expect(html).toContain("Launch confirmed");
    expect(html).toContain("Updating this craft from the confirmed block");
  });

  it("offers a wallet-read retry when the identity cannot be resolved", () => {
    const failed = protocol("transient");
    protocolState.protocol = {
      ...failed,
      walletRead: { status: "failed" as const },
    };

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    // The failure copy says to retry the read; the page offered no way to.
    expect(html).toContain("Retry wallet read");
  });

  it("describes the checkbox-gated irreversible confirmation action", () => {
    expect(source).toMatch(
      /AlertDialog\.Close[\s\S]*?aria-describedby=[\s\S]*?launch-confirmation-disabled-reason[\s\S]*?disabled=/u,
    );
    expect(source).toMatch(
      /DisabledReason[^>]*id="launch-confirmation-disabled-reason"/u,
    );
  });

  it("uses a direct onchain identity read when permanent enumeration is unavailable", () => {
    const indexed = protocol("permanent");
    indexed.transaction = { status: "idle" as const, label: "" } as never;
    indexed.walletRead.snapshot.collectibles.permanent = [];
    indexed.walletRead.snapshot.collectibles.permanentHoldingsStatus =
      "unavailable" as never;
    collectibleState.read.data = {
      status: "discovered",
      collectible: {
        ...craft,
        stateLabel: "Orbiter",
        pendingRewardsStatus: "observed",
      },
      observedAt: 1_000,
      observedBlock: 100n,
      owner: indexed.address,
      partialFailures: [],
      permanent: true,
    };
    protocolState.protocol = indexed;

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    expect(html).toContain("Orbiter #42");
    expect(html).toContain("Claim eligible rewards");
    expect(html).toContain("Transfer ORBIT 4444 Collectible");
    expect(source).toContain('type: "direct-collectible-transfer"');
  });

  it("says an identity has never been discovered instead of offering a retry", () => {
    const held = protocol("permanent");
    held.transaction = { status: "idle" as const, label: "" } as never;
    collectibleState.read.data = {
      status: "not-discovered",
      identityId: 42,
      observedAt: 1_000,
      observedBlock: 100n,
      partialFailures: [],
    };
    protocolState.protocol = held;

    const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

    // The reader observed the identity is still in the available pool, so the
    // page states that instead of a failure with a retry that cannot succeed.
    expect(html).toContain("Not yet discovered");
    expect(html).toContain(
      "This identity is still in the available pool; a Discovery assigns it when a wallet crosses a whole $FUEL.",
    );
    expect(html).toContain('data-state="empty"');
    expect(html).not.toContain("Retry wallet read");
    expect(html).not.toContain("Review Launch");
    expect(html).not.toContain("Claim eligible rewards");
    expect(html).not.toContain("Owner actions");
  });

  it.each([
    ["failed", "error", "Identity unavailable"],
    ["blocked", "blocked", "Connect a wallet"],
  ] as const)(
    "announces a %s identity state through shared feedback",
    (walletStatus, tone, title) => {
      protocolState.protocol = {
        ...protocol("transient"),
        walletRead: { status: walletStatus },
      };

      const html = renderToStaticMarkup(<CraftDetailPanel identityId={42} />);

      expect(html).toContain(`data-state="${tone}"`);
      expect(html).toContain(title);
      expect(html.match(/role="(?:alert|status)"/gu)).toHaveLength(1);
    },
  );
});
