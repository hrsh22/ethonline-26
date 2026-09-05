import type { Address, Hex } from "viem";

import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";

import type { RewardTrackLabel } from "./domain.js";

export type HealthCheckStatus = "pass" | "fail" | "unknown";
export type HealthSeverity = "info" | "warning" | "critical";

export interface BindingObservation {
  id: string;
  expected: Address;
  observed: Address;
  explanation: string;
  available?: boolean | undefined;
}

export interface SealObservation {
  id: string;
  sealed: boolean;
  explanation: string;
  available?: boolean | undefined;
}

export interface ValueObservation {
  id: string;
  expected: string;
  observed: string;
  explanation: string;
  available?: boolean | undefined;
}

export interface BytecodeObservation {
  name: string;
  displayName: string;
  address: Address;
  present: boolean;
  available?: boolean | undefined;
}

export interface RewardTrackAccounting {
  track: RewardTrackLabel;
  tokenBalance: bigint;
  liability: bigint;
  available?: boolean | undefined;
}

export interface ProtocolHealthInput {
  observedBlock: bigint;
  observedAt: number;
  currentTime: number;
  maximumAgeSeconds: number;
  liquidSupplyWei: bigint;
  permanentCount: number;
  transientCount: number;
  pendingDiscoveryCount: number;
  availableIdentityCount: number;
  expectedManifestCommitment: Hex;
  observedManifestCommitment: Hex;
  bindings: BindingObservation[];
  values: ValueObservation[];
  bytecode: BytecodeObservation[];
  seals: SealObservation[];
  rewardTracks: RewardTrackAccounting[];
  operationalChecks?: Array<
    Omit<ProtocolHealthCheck, "freshness" | "observedBlock"> & {
      available?: boolean | undefined;
    }
  >;
  rpcFailures: string[];
  availability?: {
    supplyInvariant?: boolean;
    collectionPartition?: boolean;
    identityManifest?: boolean;
  };
}

export interface ProtocolHealthCheck {
  id: string;
  status: HealthCheckStatus;
  severity: HealthSeverity;
  freshness: "fresh" | "stale";
  observedBlock: bigint;
  expected?: string;
  observed?: string;
  explanation: string;
}

const COLLECTION_SIZE = 4_444;
const ONE_LIQUID_TOKEN = 10n ** 18n;

type HealthObservation = Omit<
  ProtocolHealthCheck,
  "freshness" | "observedBlock"
> & {
  available?: boolean | undefined;
};

const createHealthCheck = (
  value: HealthObservation,
  freshness: ProtocolHealthCheck["freshness"],
  observedBlock: bigint,
  unavailable: string,
): ProtocolHealthCheck => {
  const { available = true, observed, ...observation } = value;
  const base = {
    ...observation,
    status: available ? observation.status : "unknown",
    freshness,
    observedBlock,
  } as const;
  if (!available) return { ...base, observed: unavailable };
  return observed === undefined ? base : { ...base, observed };
};

const deriveHealthStatus = (
  checks: readonly ProtocolHealthCheck[],
): "critical" | "degraded" | "healthy" => {
  if (
    checks.some(
      (item) => item.status === "fail" && item.severity === "critical",
    )
  ) {
    return "critical";
  }
  return checks.some((item) => item.status !== "pass") ? "degraded" : "healthy";
};

export const deriveProtocolHealth = (
  input: ProtocolHealthInput,
  identity: IdentityConfiguration,
) => {
  const copy = createIdentityProtocolCopy(identity).health;
  const freshness =
    input.currentTime - input.observedAt <= input.maximumAgeSeconds
      ? "fresh"
      : "stale";
  const check = (value: HealthObservation): ProtocolHealthCheck =>
    createHealthCheck(value, freshness, input.observedBlock, copy.unavailable);
  const expectedSupply = BigInt(COLLECTION_SIZE) * ONE_LIQUID_TOKEN;
  const observedSupply =
    input.liquidSupplyWei + BigInt(input.permanentCount) * ONE_LIQUID_TOKEN;
  const observedPartition =
    input.permanentCount + input.transientCount + input.availableIdentityCount;

  const checks: ProtocolHealthCheck[] = [
    check({
      id: "read-freshness",
      status: freshness === "fresh" ? "pass" : "fail",
      severity: "warning",
      expected: copy.maximumAge(input.maximumAgeSeconds),
      observed: copy.observedAge(input.currentTime - input.observedAt),
      explanation: copy.freshness,
    }),
    check({
      id: "supply-invariant",
      available: input.availability?.supplyInvariant,
      status: observedSupply === expectedSupply ? "pass" : "fail",
      severity: "critical",
      expected: expectedSupply.toString(),
      observed: observedSupply.toString(),
      explanation: copy.supplyInvariant,
    }),
    check({
      id: "collection-partition",
      available: input.availability?.collectionPartition,
      status: observedPartition === COLLECTION_SIZE ? "pass" : "fail",
      severity: "critical",
      expected: String(COLLECTION_SIZE),
      observed: String(observedPartition),
      explanation: copy.collectionPartition,
    }),
    check({
      id: "identity-manifest",
      available: input.availability?.identityManifest,
      status:
        input.expectedManifestCommitment.toLowerCase() ===
        input.observedManifestCommitment.toLowerCase()
          ? "pass"
          : "fail",
      severity: "critical",
      expected: input.expectedManifestCommitment,
      observed: input.observedManifestCommitment,
      explanation: copy.identityManifest,
    }),
    ...input.bindings.map((binding) =>
      check({
        id: `binding:${binding.id}`,
        available: binding.available,
        status:
          binding.expected.toLowerCase() === binding.observed.toLowerCase()
            ? "pass"
            : "fail",
        severity: "critical",
        expected: binding.expected,
        observed: binding.observed,
        explanation: binding.explanation,
      }),
    ),
    ...input.values.map((value) =>
      check({
        id: `value:${value.id}`,
        available: value.available,
        status: value.expected === value.observed ? "pass" : "fail",
        severity: "critical",
        expected: value.expected,
        observed: value.observed,
        explanation: value.explanation,
      }),
    ),
    ...input.bytecode.map((contract) =>
      check({
        id: `bytecode:${contract.name}`,
        available: contract.available,
        status: contract.present ? "pass" : "fail",
        severity: "critical",
        expected: copy.deployedAt(contract.address),
        observed: contract.present
          ? copy.bytecodePresent
          : copy.bytecodeMissing,
        explanation: copy.bytecode(contract.displayName),
      }),
    ),
    ...input.seals.map((seal) =>
      check({
        id: `seal:${seal.id}`,
        available: seal.available,
        status: seal.sealed ? "pass" : "fail",
        severity: "critical",
        expected: copy.sealedExpected,
        observed: seal.sealed ? copy.sealedObserved : copy.mutableObserved,
        explanation: seal.explanation,
      }),
    ),
    ...input.rewardTracks.map((track) =>
      check({
        id: `reward-solvency:${track.track}`,
        available: track.available,
        status: track.tokenBalance >= track.liability ? "pass" : "fail",
        severity: "critical",
        expected: copy.balanceAtLeast(track.liability),
        observed: track.tokenBalance.toString(),
        explanation: copy.rewardSolvency(track.track),
      }),
    ),
    ...(input.operationalChecks ?? []).map((observation) => check(observation)),
    ...input.rpcFailures.map((_failure, index) =>
      check({
        id: `rpc:${index}`,
        status: "unknown",
        severity: "warning",
        observed: copy.unavailable,
        explanation: copy.rpcFailure,
      }),
    ),
  ];

  const status = deriveHealthStatus(checks);

  return {
    status,
    freshness,
    observedBlock: input.observedBlock,
    checks,
    rpcFailures: [...input.rpcFailures],
  } as const;
};
