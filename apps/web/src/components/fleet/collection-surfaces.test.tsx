/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-delivery-status", () => ({
  useDeliveryStatus: () => ({ state: "unknown", data: undefined }),
}));
vi.mock("@/components/collector-help", () => ({ CollectorHelp: () => null }));

vi.mock("@/hooks/use-discovery-history", () => ({
  useDiscoveryHistory: () => ({ data: undefined }),
}));

const testState = vi.hoisted(() => ({ protocol: undefined as unknown }));
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
  useProtocolClient: () => testState.protocol,
}));
vi.mock("@/hooks/use-collectible-read", () => ({
  useCollectibleRead: () => collectibleState.read,
}));

// Only the rendered notice is stubbed. `blockedAccessMessage` is the reason
// text these surfaces are being asserted on, so it stays real.
vi.mock("@/components/access-notice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/access-notice")>()),
  AccessNotice: () => null,
}));

import { CraftDetailPanel } from "./craft-detail-panel";
import { FleetPanel } from "./fleet-panel";
import { RelicsPanel } from "./relics-panel";
import { protocolDeploymentManifest } from "@/lib/deployment";

const collectibleAddress = protocolDeploymentManifest?.contracts.fuelMirror;
if (collectibleAddress === undefined) {
  throw new Error("The staging collectible address is unavailable");
}

/** The filter control is addressed by its accessible name, not by a class. */
const filterButtons = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Filter collection"] button',
  ),
];

const craft = (identityId: number) => ({
  identityId,
  stateLabel: "Grounded Craft",
  rewardTrack: "Track 1",
  rarityTier: "Common",
  rewardWeight: 1,
  specialKindCode: "ordinary" as const,
  specialKind: "Ordinary",
  pendingRewards: [],
  pendingRewardsStatus: "observed" as const,
  claimEligible: false,
});

const walletSnapshot = (
  transient: readonly number[],
  permanent: readonly number[],
) => ({
  observedAt: 1_700_000_000,
  observedBlock: 100n,
  liquidToken: {
    formatted: "2",
    rawWei: 2n * 10n ** 18n,
    nextDiscoveryDraw: {
      thresholdWei: 3n * 10n ** 18n,
      thresholdFormatted: "3",
      remainingWei: 1n * 10n ** 18n,
      remainingFormatted: "1",
    },
  },
  settlementToken: { formatted: "5", rawWei: 5n * 10n ** 18n },
  collectibles: {
    transient: transient.map(craft),
    permanent: permanent.map((id) => ({
      ...craft(id),
      stateLabel: "Orbiter",
    })),
    pendingDiscovery: { count: 0 },
    permanentHoldingsStatus: "complete" as const,
  },
  partialFailures: [],
});

const protocol = (
  walletRead: unknown,
  health: unknown = { rewards: { tracks: [] } },
) => ({
  accessState: "ready" as const,
  address: "0x0000000000000000000000000000000000004444" as const,
  health,
  walletRead,
  refresh: vi.fn().mockResolvedValue(undefined),
  refreshWallet: vi.fn().mockResolvedValue(undefined),
  transaction: { status: "idle" as const },
  execute: vi.fn(),
  retry: vi.fn(),
});

describe("collection surfaces", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, "", "/fleet");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (node: React.ReactNode) => {
    await act(async () => root.render(node));
  };

  describe("fleet", () => {
    it("links the collection to its public Base Sepolia record", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1], [2]),
      });
      await render(<FleetPanel />);

      const link = container.querySelector<HTMLAnchorElement>(
        "a[data-collectible-explorer='collection']",
      );
      expect(link?.href).toBe(
        `https://base-sepolia.blockscout.com/token/${collectibleAddress}`,
      );
      expect(link?.textContent).toContain("View onchain collection");
    });

    it("puts holdings ahead of the metric summary", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1], [2]),
      });
      await render(<FleetPanel />);

      // Selected by role rather than by class name: the holdings list and
      // the summary description list are stable, generated class names are
      // not — which is what broke these assertions when the surface was
      // rebuilt.
      const grid = container.querySelector("ul:has(article)");
      const metrics = container.querySelector(
        '[aria-label="Collection summary"]',
      );
      expect(grid).not.toBeNull();
      expect(metrics).not.toBeNull();
      expect(grid?.compareDocumentPosition(metrics as Node) ?? 0).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it.each([
      [0n, "observed", true, "No rewards ready to claim."],
      [1n, "observed", true, "Attached rewards are ready to claim."],
      [
        1n,
        "observed",
        false,
        "Rewards are attached; claiming is not available yet.",
      ],
      [0n, "unavailable", true, "could not be loaded"],
      [1n, "unavailable", true, "could not be loaded"],
    ] as const)(
      "explains rewards from %s units, %s evidence, and eligibility %s",
      async (rawTokenUnits, pendingRewardsStatus, claimEligible, message) => {
        const snapshot = walletSnapshot([1], [2]);
        testState.protocol = protocol({
          status: "loaded",
          snapshot: {
            ...snapshot,
            collectibles: {
              ...snapshot.collectibles,
              permanent: [
                {
                  ...craft(2),
                  stateLabel: "Orbiter",
                  claimEligible,
                  pendingRewardsStatus,
                  pendingRewards: [{ track: "Track 1", rawTokenUnits }],
                },
              ],
            },
          },
        });
        await render(<FleetPanel />);

        const cards = [...container.querySelectorAll("article")];
        expect(cards[0]?.textContent).toContain("Launch burns 1 $FUEL forever");
        expect(cards[0]?.textContent).toContain(
          "Reward claims begin after Launch",
        );
        expect(cards[1]?.textContent).toContain(message);
        if (pendingRewardsStatus === "unavailable") {
          expect(cards[1]?.textContent).not.toContain("None attached");
          expect(cards[1]?.textContent).not.toContain("No rewards ready");
          expect(cards[1]?.textContent).not.toContain(
            "Attached rewards are ready",
          );
        }
        for (const card of cards) {
          expect(card.textContent).toContain("Last confirmed");
        }
      },
    );

    it("filters a 50-item Fleet locally and reveals more cards in manageable groups", async () => {
      const snapshot = walletSnapshot(
        [],
        Array.from({ length: 50 }, (_, index) => index + 1),
      );
      const current = protocol({ status: "loaded", snapshot });
      testState.protocol = current;
      await render(<FleetPanel />);
      expect(container.querySelectorAll("article")).toHaveLength(24);
      const more = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Show more collectibles",
      );
      await act(async () => more?.click());
      expect(container.querySelectorAll("article")).toHaveLength(48);
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="Find a held identity"]',
      );
      expect(input).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, "42");
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.querySelectorAll("article")).toHaveLength(1);
      expect(container.querySelector("article")?.textContent).toContain(
        "#0042",
      );
      expect(window.location.search).toContain("id=42");
      expect(current.refreshWallet).not.toHaveBeenCalled();
    });

    it("combines state and track filters, labels unknown rewards, and resets on wallet change", async () => {
      const snapshot = walletSnapshot([1], [2, 3]);
      snapshot.collectibles.transient[0]!.rewardTrack = "AAPLc";
      snapshot.collectibles.permanent[0]!.rewardTrack = "AAPLc";
      const permanent = snapshot.collectibles.permanent.map((entry) => ({
        ...entry,
        claimEligible: true,
        pendingRewardsStatus:
          entry.identityId === 3 ? "unavailable" : "observed",
        pendingRewards: [{ track: "AAPLc", rawTokenUnits: 10n ** 18n }],
      }));
      const current = protocol({
        status: "loaded",
        snapshot: {
          ...snapshot,
          collectibles: { ...snapshot.collectibles, permanent },
        },
      });
      testState.protocol = current;
      await render(<FleetPanel />);
      await act(async () => filterButtons(container)[2]?.click());
      const select = async (label: string, value: string) => {
        const control = container.querySelector<HTMLSelectElement>(
          `select[aria-label="${label}"]`,
        );
        await act(async () => {
          if (control) control.value = value;
          control?.dispatchEvent(new Event("change", { bubbles: true }));
        });
      };
      await select("Filter Reward Track", "AAPLc");
      expect(container.querySelectorAll("article")).toHaveLength(1);
      await select("Filter Reward Track", "all");
      await select("Filter rewards", "claimable");
      expect(container.querySelectorAll("article")).toHaveLength(1);
      expect(container.textContent).toContain(
        "Some rewards are still updating and are excluded",
      );
      await select("Filter rewards", "updating");
      expect(container.querySelector("article")?.textContent).toContain(
        "#0003",
      );
      testState.protocol = {
        ...protocol({ status: "loaded", snapshot: walletSnapshot([4], []) }),
        address: "0x0000000000000000000000000000000000001234",
      };
      await render(<FleetPanel />);
      expect(container.querySelector("article")?.textContent).toContain(
        "#0004",
      );
      expect(
        container.querySelector<HTMLSelectElement>(
          'select[aria-label="Filter rewards"]',
        )?.value,
      ).toBe("all");
      expect(current.refreshWallet).not.toHaveBeenCalled();
    });

    it("restores URL filters when browser Back returns to Fleet", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1], [2]),
      });
      await render(<FleetPanel />);
      await act(async () => {
        window.history.replaceState(null, "", "/fleet?state=permanent&id=2");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(container.querySelectorAll("article")).toHaveLength(1);
      expect(container.querySelector("article")?.textContent).toContain(
        "#0002",
      );
      expect(
        container.querySelector<HTMLInputElement>(
          'input[aria-label="Find a held identity"]',
        )?.value,
      ).toBe("2");
    });

    it("keeps last verified holdings visible when the connection is interrupted", async () => {
      testState.protocol = protocol({
        status: "loaded",
        stale: true,
        snapshot: walletSnapshot([], [42]),
      });
      await render(<FleetPanel />);
      expect(container.textContent).toContain("Connection interrupted");
      expect(container.querySelector("article")?.textContent).toContain(
        "#0042",
      );
    });

    it("offers a wrong-network wallet the network, not a connect button", async () => {
      testState.protocol = protocol({
        accessState: "wrong-network",
        status: "blocked",
      });
      await render(<FleetPanel />);

      // The wallet is connected on the wrong chain, so "Wallet not connected"
      // named the wrong condition and the connect action could not clear it.
      expect(container.textContent).toContain("Wrong network");
      expect(container.textContent).not.toContain("Wallet not connected");
      expect(container.querySelector("a[href='/start']")).toBeNull();
    });

    it("gives an empty collection a next action", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([], []),
      });
      await render(<FleetPanel />);

      expect(container.querySelector("a[href='/exchange']")).toBeNull();
      expect(
        container.querySelector("a[href='/faucet?returnTo=/fleet']")
          ?.textContent,
      ).toContain("Faucet");
    });

    it.each([
      "waiting-for-randomness",
      "ready-for-finalization",
      "finalizing",
      "delayed",
    ])(
      "tracks a %s discovery without asking the collector to retry or buy again",
      async (phase) => {
        const snapshot = walletSnapshot([], []);
        testState.protocol = protocol({
          status: "loaded",
          snapshot: {
            ...snapshot,
            collectibles: {
              ...snapshot.collectibles,
              pendingDiscovery: { count: 1, phase },
            },
          },
        });
        await render(<FleetPanel />);

        expect(container.textContent).not.toContain("Refresh wallet");
        expect(container.textContent).not.toContain("No collectibles yet");
        expect(container.querySelector("a[href='/exchange']")).toBeNull();
        expect(container.querySelector("[data-state='success']")).toBeNull();
      },
    );

    it("explains a filter with nothing behind it instead of a bare region", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1, 2], []),
      });
      await render(<FleetPanel />);

      await act(async () => filterButtons(container)[2]?.click());
      // The only hint used to be the zero count up in the segmented control.
      expect(container.querySelector("ul:has(article)")).toBeNull();
      expect(container.textContent).toContain("Nothing matches this filter");
    });

    it("automatically refreshes incomplete holdings without asking for another purchase", async () => {
      const snapshot = walletSnapshot([], []);
      testState.protocol = protocol({
        status: "loaded",
        snapshot: {
          ...snapshot,
          collectibles: {
            ...snapshot.collectibles,
            permanentHoldingsStatus: "unavailable" as const,
          },
        },
      });
      await render(<FleetPanel />);

      expect(container.querySelector("a[href='/exchange']")).toBeNull();
      expect(container.textContent).toContain("incomplete");
      expect(container.textContent).toContain("check again automatically");
      expect(container.querySelector("button")).toBeNull();
    });

    it("calls out stalled delivery after randomness has already arrived", async () => {
      const snapshot = walletSnapshot([], []);
      testState.protocol = protocol({
        status: "loaded",
        snapshot: {
          ...snapshot,
          observedAt: 2_000,
          collectibles: {
            ...snapshot.collectibles,
            pendingDiscovery: {
              count: 1,
              phase: "ready-for-finalization",
              batch: {
                state: "ready",
                fulfilledAt: 1_000n,
                requestedAt: 500n,
                vrfRequestId: 44n,
                count: 1,
                finalizedCount: 0,
              },
            },
          },
        },
      });
      await render(<FleetPanel />);
      expect(
        container.querySelector("[data-state='stale']")?.textContent,
      ).toContain("Collectible delivery is delayed");
      expect(container.textContent).toContain("Your random draw is verified");
      expect(container.textContent).not.toContain(
        "randomness service hasn't responded",
      );
      expect(container.querySelector("button")).toBeNull();
    });

    it("explains a delayed external randomness request without claiming assets were lost", async () => {
      const snapshot = walletSnapshot([1], []);
      testState.protocol = protocol({
        status: "loaded",
        snapshot: {
          ...snapshot,
          collectibles: {
            ...snapshot.collectibles,
            pendingDiscovery: {
              count: 8,
              phase: "delayed" as const,
              batch: {
                vrfRequestId: 44n,
                sequence: 3n,
                state: "awaiting-randomness" as const,
                requestedAt: 900n,
                fulfilledAt: undefined,
                count: 8,
                finalizedCount: 0,
                delayReported: true,
                delayed: true,
                fullyCancelled: false,
              },
            },
          },
        },
      });

      await render(<FleetPanel />);

      expect(container.textContent).toContain(
        "Randomness is taking longer than expected",
      );
      expect(container.textContent).toContain("15-minute delay threshold");
      expect(container.textContent).toContain(
        "FUEL backing recorded · 8 pending Discoveries",
      );
      // The progress notice leads the route. Below the
      // grid, a wallet holding sixteen craft pushed it about ten thousand
      // pixels down a phone viewport.
      const notice = container.querySelector("[data-state='stale']");
      const grid = container.querySelector("ul:has(article)");
      expect(notice).not.toBeNull();
      expect(notice?.compareDocumentPosition(grid as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it("filters transient and permanent holdings in place", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1, 2], [3]),
      });
      await render(<FleetPanel />);

      expect(container.querySelectorAll("article")).toHaveLength(3);
      const buttons = filterButtons(container);
      expect(buttons.map((button) => button.textContent)).toEqual([
        "All (3)",
        "Grounded Craft (2)",
        "Orbiter (1)",
      ]);

      await act(async () => filterButtons(container)[1]?.click());
      expect(container.querySelectorAll("article")).toHaveLength(2);

      await act(async () => filterButtons(container)[2]?.click());
      expect(container.querySelectorAll("article")).toHaveLength(1);
    });

    it("marks permanent holdings distinctly from transient ones", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1], [2]),
      });
      await render(<FleetPanel />);

      expect(
        container.querySelectorAll("article[data-permanent]"),
      ).toHaveLength(1);
    });

    it("draws each holding its own generated identity mark", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([1, 2], []),
      });
      await render(<FleetPanel />);

      const marks = [
        ...container.querySelectorAll<SVGElement>(
          "article > div:first-child svg[aria-hidden]",
        ),
      ];
      expect(marks).toHaveLength(2);
      // The mark repeats the identity printed beside it, so it is decoration.
      expect(marks[0]?.getAttribute("role")).toBeNull();
      // Two identities must not draw the same mark; adjacent ids share most of
      // their bits, so the generator has to avalanche the seed.
      expect(marks[0]?.innerHTML).not.toBe(marks[1]?.innerHTML);
    });
  });

  describe("relics", () => {
    it("represents all three basket identities and the indicator", async () => {
      testState.protocol = protocol({ status: "blocked" });
      await render(<RelicsPanel />);

      const cards = [...container.querySelectorAll("article[data-ownership]")];
      expect(cards).toHaveLength(4);
      const text = container.textContent ?? "";
      for (const identityId of [4441, 4442, 4443, 4444]) {
        expect(text).toContain(`#${identityId}`);
      }
      expect(text).toContain("Station One");
      expect(text).toContain("Station Two");
      expect(text).toContain("Station Three");
      expect(text).toContain("Observatory");
      expect(container.querySelectorAll("[data-relic-role]")).toHaveLength(4);
      // Nothing in the protocol defines a per-relic attribute, so the cards
      // state only manifest facts: number, kind, allocation, ownership.
      expect(text).not.toContain("instrument");
      expect(text).not.toContain("lens");
      expect(text).toContain("12.5% of every Reward Track, divided equally");
      expect(
        new Set(
          [...container.querySelectorAll("[data-relic-role]")].map((node) =>
            node.getAttribute("data-relic-role"),
          ),
        ).size,
      ).toBe(4);
    });

    it("never claims wallet eligibility while disconnected", async () => {
      testState.protocol = protocol({
        accessState: "disconnected",
        status: "blocked",
      });
      await render(<RelicsPanel />);

      expect(container.querySelectorAll("[data-relic-card] a")).toHaveLength(4);
      expect(container.textContent).not.toContain("Eligible now");
      expect(container.textContent).toContain("Connect a wallet");
      expect(
        container.querySelectorAll("article[data-ownership='unknown']"),
      ).toHaveLength(4);
    });

    it("does not ask a wrong-network wallet to connect", async () => {
      testState.protocol = protocol({
        accessState: "wrong-network",
        status: "blocked",
      });
      await render(<RelicsPanel />);

      // The wallet is connected; only its chain is wrong. Repeating the
      // connect instruction on four cards gave it nothing it could act on.
      expect(container.textContent).toContain("Wrong network");
      expect(container.textContent).not.toContain("Connect a wallet");
    });

    it("reports live ownership and links held identities to detail", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([], [4442]),
      });
      await render(<RelicsPanel />);

      expect(
        container.querySelectorAll("article[data-ownership='held']"),
      ).toHaveLength(1);
      expect(
        container.querySelectorAll("article[data-ownership='not-held']"),
      ).toHaveLength(3);
      const link = container.querySelector("a[href='/fleet/4442']");
      expect(link?.textContent).toBe("Inspect #4442");
    });

    it("keeps missing Relics unknown until ownership enumeration recovers", async () => {
      const snapshot = walletSnapshot([], [4442]);
      testState.protocol = protocol({
        status: "loaded",
        snapshot: {
          ...snapshot,
          collectibles: {
            ...snapshot.collectibles,
            permanentHoldingsStatus: "unavailable",
          },
        },
      });
      await render(<RelicsPanel />);
      expect(
        container.querySelector("a[href='/fleet/4442']")?.textContent,
      ).toBe("Inspect #4442");
      expect(container.textContent).toContain("Ownership is updating");
      expect(
        container.querySelectorAll("article[data-ownership='not-held']"),
      ).toHaveLength(0);
      expect(container.querySelector("a[href='/exchange']")).toBeNull();
      testState.protocol = protocol({ status: "loaded", snapshot });
      await render(<RelicsPanel />);
      expect(
        container.querySelectorAll("article[data-ownership='not-held']"),
      ).toHaveLength(3);
    });

    it("recognizes a Grounded Relic as held before Launch", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([4441], []),
      });
      await render(<RelicsPanel />);
      expect(
        container.querySelector("a[href='/fleet/4441']")?.textContent,
      ).toBe("Inspect #4441");
      expect(container.querySelector("a[href='/exchange']")).toBeNull();
    });

    it("lets visitors inspect every public Relic without owning it", async () => {
      testState.protocol = protocol({
        status: "loaded",
        snapshot: walletSnapshot([], []),
      });
      await render(<RelicsPanel />);

      for (const identityId of [4441, 4442, 4443, 4444]) {
        expect(
          container.querySelector(`a[href='/fleet/${identityId}']`)
            ?.textContent,
        ).toBe(`Inspect #${identityId}`);
      }
    });
  });
  describe("craft detail rewards", () => {
    const withRewards = (
      rewards: readonly { track: string; rawTokenUnits: bigint }[],
      status: "observed" | "unavailable",
    ) => {
      const snapshot = walletSnapshot([], [7]);
      return protocol({
        status: "loaded",
        snapshot: {
          ...snapshot,
          collectibles: {
            ...snapshot.collectibles,
            permanent: [
              {
                ...snapshot.collectibles.permanent[0],
                pendingRewards: rewards,
                pendingRewardsStatus: status,
              },
            ],
          },
        },
      });
    };

    it("reports a genuine zero as no rewards accrued", async () => {
      testState.protocol = withRewards(
        [{ track: "Track 1", rawTokenUnits: 0n }],
        "observed",
      );
      await render(<CraftDetailPanel identityId={7} />);

      const attachment = container.querySelector(
        '[aria-labelledby="attached-rewards-heading"]',
      );
      expect(attachment?.textContent).toContain("No rewards accrued");
      expect(attachment?.textContent).not.toContain("Not observed");
    });

    it("links the identity and its collection to public explorers", async () => {
      testState.protocol = withRewards([], "observed");
      await render(<CraftDetailPanel identityId={7} />);

      expect(
        container.querySelector<HTMLAnchorElement>(
          "a[data-collectible-explorer='identity']",
        )?.href,
      ).toBe(`https://sepolia.basescan.org/nft/${collectibleAddress}/7`);
      expect(
        container.querySelector<HTMLAnchorElement>(
          "a[data-collectible-explorer='collection']",
        )?.href,
      ).toBe(`https://base-sepolia.blockscout.com/token/${collectibleAddress}`);
      expect(
        container.querySelectorAll("a[data-collectible-explorer]"),
      ).toHaveLength(2);
    });

    it("keeps the public identity record available without a connected wallet", async () => {
      testState.protocol = {
        ...protocol({ status: "blocked" }),
        accessState: "disconnected",
      };
      await render(<CraftDetailPanel identityId={7} />);

      expect(
        container.querySelector<HTMLAnchorElement>(
          "a[data-collectible-explorer='identity']",
        )?.href,
      ).toBe(`https://sepolia.basescan.org/nft/${collectibleAddress}/7`);
    });

    it("keeps unreadable reward evidence explicitly unavailable", async () => {
      testState.protocol = withRewards(
        [{ track: "Track 1", rawTokenUnits: 0n }],
        "unavailable",
      );
      await render(<CraftDetailPanel identityId={7} />);

      const attachment = container.querySelector(
        '[aria-labelledby="attached-rewards-heading"]',
      );
      expect(attachment?.textContent).toContain("temporarily unavailable");
      expect(attachment?.textContent).not.toContain("No rewards accrued");
    });

    it("shows readable amounts with exact raw units on demand", async () => {
      testState.protocol = withRewards(
        [{ track: "Track 1", rawTokenUnits: 1_500_000_000_000_000_000n }],
        "observed",
      );
      await render(<CraftDetailPanel identityId={7} />);

      const attachment = container.querySelector(
        '[aria-labelledby="attached-rewards-heading"]',
      );
      // The readable amount is the displayed value; the exact integer stays
      // available as claim evidence rather than being printed at eighteen
      // decimals in the row.
      expect(attachment?.querySelector("dd span")?.textContent).toContain(
        "1.5",
      );
      expect(attachment?.querySelector("code")?.textContent).toBe(
        "1500000000000000000",
      );
    });
  });
});

describe("heading structure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState(null, "", "/fleet");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    collectibleState.read.data = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (element: React.ReactElement) => {
    await act(async () => root.render(element));
  };

  /**
   * The route accessibility audit only ever loads the disconnected state, so a
   * skipped heading level inside a collectible card is invisible to it — the
   * card never renders. These assert the level directly.
   */
  it("keeps collectible cards at one level below the page heading", async () => {
    testState.protocol = protocol({
      status: "loaded",
      snapshot: walletSnapshot([1], [2]),
    });
    await render(<FleetPanel />);

    const cards = [...container.querySelectorAll("article")];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.querySelector("h2")).not.toBeNull();
      expect(card.querySelector("h3")).toBeNull();
    }
  });

  it("keeps relic cards at one level below the page heading", async () => {
    testState.protocol = protocol({ status: "blocked" });
    await render(<RelicsPanel />);

    const cards = [...container.querySelectorAll("article[data-ownership]")];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.querySelector("h2")).not.toBeNull();
      expect(card.querySelector("h3")).toBeNull();
    }
  });
});
