import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

import StartPage from "./(collector)/start/page";
import RewardsPage from "./(collector)/rewards/page";

describe("collector route compatibility", () => {
  it("retires Start with a fixed collection redirect, without wallet facts", () => {
    expect(() => StartPage()).toThrow("redirect:/fleet");
  });
  it("keeps old reward links pointed directly at personal claims", () => {
    expect(() => RewardsPage()).toThrow("redirect:/fleet?view=rewards");
  });
});
