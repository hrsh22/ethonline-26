import type { DataFixture, WalletFixture } from "./fixtures.ts";

export interface Viewport {
  readonly height: number;
  readonly label: string;
  readonly width: number;
}

/**
 * The release widths, plus focused shell regressions: 320px compact, 781px
 * just above tablet, and 1161/1200px around the formerly colliding wide nav.
 */
export const RELEASE_VIEWPORTS: readonly Viewport[] = [
  { height: 780, label: "375", width: 375 },
  { height: 1024, label: "768", width: 768 },
  { height: 768, label: "1024", width: 1024 },
  { height: 900, label: "1440", width: 1440 },
];

export const SHELL_VIEWPORTS: readonly Viewport[] = [
  { height: 720, label: "320", width: 320 },
  { height: 900, label: "781", width: 781 },
  { height: 820, label: "1161", width: 1161 },
  { height: 838, label: "1200", width: 1200 },
];

export interface RouteCase {
  readonly axe: boolean;
  readonly label: string;
  readonly path: string;
  /** Where the browser is expected to end up, when it differs from `path`. */
  readonly finalPath?: string;
  readonly screenshot?: boolean;
  readonly status?: number;
}

/** Every public route, both craft-detail outcomes, and both 404 shapes. */
export const ROUTE_CASES: readonly RouteCase[] = [
  { axe: true, label: "home", path: "/", screenshot: true },
  { axe: true, label: "start", path: "/start", screenshot: true },
  { axe: true, label: "faucet", path: "/faucet", screenshot: true },
  { axe: true, label: "exchange", path: "/exchange", screenshot: true },
  { axe: true, label: "market", path: "/market", screenshot: true },
  { axe: true, label: "fleet", path: "/fleet", screenshot: true },
  { axe: true, label: "craft-detail", path: "/fleet/42" },
  {
    axe: true,
    label: "craft-detail-invalid",
    path: "/fleet/4445",
    status: 404,
  },
  {
    axe: true,
    label: "craft-detail-malformed",
    path: "/fleet/4e2",
    status: 404,
  },
  {
    axe: true,
    label: "craft-detail-leading-zero",
    path: "/fleet/0042",
    status: 404,
  },
  { axe: true, label: "rewards", path: "/rewards", screenshot: true },
  { axe: true, label: "relics", path: "/relics" },
  { axe: true, label: "status", path: "/status", screenshot: true },
  { axe: true, label: "learn", path: "/learn", screenshot: true },
  { axe: true, label: "global-404", path: "/does-not-exist", status: 404 },
  {
    axe: true,
    label: "admin-sign-in",
    path: "/admin/sign-in",
    screenshot: true,
  },
  {
    axe: true,
    finalPath: "/admin/sign-in?next=%2Fadmin",
    label: "admin-protected",
    path: "/admin",
    status: 307,
  },
  {
    axe: true,
    finalPath: "/admin/sign-in?next=%2Fadmin%2Fdiagnostics",
    label: "admin-diagnostics-protected",
    path: "/admin/diagnostics",
    status: 307,
  },
];

export interface StateCase {
  readonly data: DataFixture;
  readonly label: string;
  readonly path: string;
  readonly heading?: string;
  readonly wallet: WalletFixture;
}

/**
 * Wallet and data states paired with the routes that actually model them.
 * Running every state against every route would be slow without adding cover.
 */
export const STATE_CASES: readonly StateCase[] = [
  {
    data: "cached-stale",
    label: "cached-stale",
    path: "/status",
    wallet: "disconnected",
  },
  {
    data: "market",
    label: "market-history",
    path: "/market",
    wallet: "disconnected",
  },
  {
    data: "stubbed",
    label: "disconnected",
    path: "/faucet",
    heading: "Connect a wallet to check eligibility",
    wallet: "disconnected",
  },
  {
    data: "stubbed",
    label: "connecting",
    path: "/faucet",
    wallet: "connecting",
  },
  {
    data: "stubbed",
    label: "wrong-network",
    path: "/faucet",
    heading: "Switch to Base Sepolia",
    wallet: "wrong-network",
  },
  {
    data: "stubbed",
    label: "ordinary-wallet",
    path: "/faucet",
    heading: "Wallet is eligible",
    wallet: "ordinary",
  },
  {
    data: "loading",
    label: "loading",
    path: "/faucet",
    heading: "Checking this wallet",
    wallet: "ordinary",
  },
  {
    data: "empty",
    label: "empty",
    path: "/faucet",
    heading: "Faucet inventory is empty",
    wallet: "ordinary",
  },
  {
    data: "failed",
    label: "failed",
    path: "/faucet",
    heading: "Faucet temporarily unavailable",
    wallet: "ordinary",
  },
  {
    data: "funded",
    label: "funded",
    path: "/faucet",
    heading: "Wallet funded for the test journey",
    wallet: "ordinary",
  },
  {
    data: "cooldown",
    label: "cooldown",
    path: "/faucet",
    heading: "Wallet is in cooldown",
    wallet: "ordinary",
  },
];
