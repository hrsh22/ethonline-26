import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { Effect, Schema } from "effect";

import {
  readLaunchedBaseSepoliaManifest,
  resolveRepositoryPath,
} from "./base-sepolia-manifest.ts";
import {
  decodeEnvironment,
  ensure,
  fileSystem,
  runMain,
  subprocess,
  validate,
  redactDiagnostic,
  strippedOfSigningKeys,
} from "./effect-runtime.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const VerificationEnvironmentSchema = Schema.Struct({
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(NonEmptyString),
  VERIFICATION_EVIDENCE_PATH: Schema.optional(NonEmptyString),
});

const hasReusableBaseScanEvidence = (contract: {
  readonly address: string;
  readonly baseScanStatus?: string | undefined;
  readonly baseScanUrl?: string | undefined;
}) =>
  contract.address.length > 0 &&
  contract.baseScanStatus === "exact_match" &&
  typeof contract.baseScanUrl === "string";

const sourceVerificationIsExact = (status: number | null, output: string) =>
  status === 0 &&
  (output.includes("exact_match") ||
    output.toLowerCase().includes("already verified"));

runMain(
  Effect.gen(function* () {
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const environment = yield* decodeEnvironment(
      VerificationEnvironmentSchema,
      "Source-verification environment is invalid",
    );
    const manifestPath = resolveRepositoryPath(
      repositoryRoot,
      environment.DEPLOYMENT_MANIFEST_PATH,
      "deployments/84532.json",
    );
    const evidencePath = resolveRepositoryPath(
      repositoryRoot,
      environment.VERIFICATION_EVIDENCE_PATH,
      "deployments/84532-verification.json",
    );
    const manifest = yield* readLaunchedBaseSepoliaManifest(manifestPath);

    const previousBaseScanEvidence = yield* Effect.gen(function* () {
      const previousEvidenceSchema = Schema.Struct({
        chainId: Schema.Number,
        contracts: Schema.Array(
          Schema.Struct({
            address: Schema.String,
            baseScanStatus: Schema.optional(Schema.String),
            baseScanUrl: Schema.optional(Schema.String),
            baseScanCheckedAt: Schema.optional(Schema.String),
          }),
        ),
      });
      const previousEvidenceText = yield* fileSystem(
        "Could not inspect previous source-verification evidence",
        () =>
          existsSync(evidencePath)
            ? readFileSync(evidencePath, "utf8")
            : undefined,
      );
      const previousEvidence =
        previousEvidenceText === undefined
          ? undefined
          : yield* validate(
              "Previous source-verification evidence is invalid",
              () =>
                Schema.decodeUnknownSync(previousEvidenceSchema)(
                  JSON.parse(previousEvidenceText) as unknown,
                ),
            );
      const reusableContracts =
        previousEvidence?.chainId === manifest.chainId
          ? previousEvidence.contracts
          : [];
      return new Map(
        reusableContracts
          .filter(hasReusableBaseScanEvidence)
          .map((contract) => [contract.address.toLowerCase(), contract]),
      );
    });

    const sourceContracts = {
      weth: "src/test-assets/MintableTestWETH.sol:MintableTestWETH",
      usdc: "src/test-assets/MintableTestToken.sol:MintableTestToken",
      mockAaplc: "src/test-assets/MockStock.sol:MockStock",
      mockGooglc: "src/test-assets/MockStock.sol:MockStock",
      mockMetac: "src/test-assets/MockStock.sol:MockStock",
      mockNvdac: "src/test-assets/MockStock.sol:MockStock",
      testConversionVenue:
        "src/test-assets/TestConversionVenue.sol:TestConversionVenue",
      attributeRegistry: "src/AttributeRegistry.sol:AttributeRegistry",
      recoveryAuthority:
        "src/deployment/TestnetThresholdRecoveryAuthority.sol:TestnetThresholdRecoveryAuthority",
      discoveryAdapter:
        "src/discovery/QuotronDiscoveryAdapter.sol:QuotronDiscoveryAdapter",
      fuelCore: "src/FuelCore.sol:FuelCore",
      fuelMirror: "src/FuelMirror.sol:FuelMirror",
      // The bound gate is a deployment decision, so the source to verify
      // follows the policy the manifest records rather than a fixed name.
      // Verifying the wrong one fails with a bytecode length mismatch.
      claimGate:
        manifest.claimPolicy?.mode === "configurable"
          ? "src/claim/ConfigurableClaimGate.sol:ConfigurableClaimGate"
          : "src/claim/AlwaysAllowClaimGate.sol:AlwaysAllowClaimGate",
      rewardLedger: "src/RewardLedger.sol:RewardLedger",
      epochConverter: "src/conversion/EpochConverter.sol:EpochConverter",
      canonicalMarketRegistry:
        "src/market/CanonicalMarketRegistry.sol:CanonicalMarketRegistry",
      protocolLiquidityVault:
        "src/liquidity/ProtocolLiquidityVault.sol:ProtocolLiquidityVault",
      canonicalHookDeployer:
        "src/market/CanonicalHookDeployer.sol:CanonicalHookDeployer",
      canonicalFeeHook: "src/market/CanonicalFeeHook.sol:CanonicalFeeHook",
      canonicalRouter: "src/market/CanonicalRouter.sol:CanonicalRouter",
      metadataRenderer:
        "src/metadata/PlaceholderMetadataRenderer.sol:PlaceholderMetadataRenderer",
      aaplcConversionAdapter:
        "src/conversion/SepoliaV4ConversionAdapter.sol:SepoliaV4ConversionAdapter",
      googlcConversionAdapter:
        "src/conversion/SepoliaV4ConversionAdapter.sol:SepoliaV4ConversionAdapter",
      metacConversionAdapter:
        "src/conversion/SepoliaV4ConversionAdapter.sol:SepoliaV4ConversionAdapter",
      nvdacConversionAdapter:
        "src/conversion/SepoliaV4ConversionAdapter.sol:SepoliaV4ConversionAdapter",
      ...(manifest.schemaVersion === 2
        ? {
            genesisLiquidityVault:
              "src/liquidity/GenesisLiquidityVault.sol:GenesisLiquidityVault",
          }
        : {
            ...("ccaCreate2Deployer" in manifest.contracts
              ? {
                  ccaCreate2Deployer:
                    "src/deployment/CcaCreate2Deployer.sol:CcaCreate2Deployer",
                }
              : {}),
            ccaLaunchFunding:
              "src/deployment/CcaLaunchFunding.sol:CcaLaunchFunding",
            ccaBidEscrowFactory:
              "src/launch/CcaBidEscrowFactory.sol:CcaBidEscrowFactory",
            ccaBidValidationHook:
              "src/launch/CcaBidValidationHook.sol:CcaBidValidationHook",
            ccaCanonicalLaunchReadiness:
              "src/launch/CcaCanonicalLaunchReadiness.sol:CcaCanonicalLaunchReadiness",
            ccaLaunchCoordinator:
              "src/launch/CcaLaunchCoordinator.sol:CcaLaunchCoordinator",
            ccaRecoverySeeder:
              "src/launch/CcaRecoverySeeder.sol:CcaRecoverySeeder",
            permanentPositionRecipient:
              "src/launch/PermanentPositionRecipient.sol:PermanentPositionRecipient",
          }),
    };

    const contractsRoot = resolve(repositoryRoot, "packages/contracts");
    const verifySource = (name: keyof typeof sourceContracts, source: string) =>
      Effect.gen(function* () {
        const address = manifest.contracts[name];
        const checkedAddress = address;
        const repositoryUrl = `https://sourcify.dev/server/v2/contract/84532/${checkedAddress}`;
        const existingExactMatch = yield* Effect.promise(async () => {
          try {
            const response = await fetch(repositoryUrl);
            if (!response.ok) return undefined;
            const result = (await response.json()) as {
              readonly runtimeMatch?: string | undefined;
              readonly verifiedAt?: string | undefined;
            };
            return result.runtimeMatch === "exact_match" ? result : undefined;
          } catch {
            return undefined;
          }
        });
        const priorBaseScanEvidence = previousBaseScanEvidence.get(
          checkedAddress.toLowerCase(),
        );
        if (existingExactMatch !== undefined) {
          return {
            name,
            address: checkedAddress,
            source,
            status: "exact_match" as const,
            repositoryUrl,
            sourcifyCheckedAt: existingExactMatch.verifiedAt,
            ...(priorBaseScanEvidence === undefined
              ? {}
              : {
                  baseScanStatus: priorBaseScanEvidence.baseScanStatus,
                  baseScanUrl: priorBaseScanEvidence.baseScanUrl,
                  ...(typeof priorBaseScanEvidence.baseScanCheckedAt ===
                  "string"
                    ? {
                        baseScanCheckedAt:
                          priorBaseScanEvidence.baseScanCheckedAt,
                      }
                    : {}),
                }),
          };
        }
        const verification = yield* subprocess(
          `Could not start source verification for ${name}`,
          () =>
            spawnSync(
              "forge",
              [
                "verify-contract",
                "--chain",
                "84532",
                "--verifier",
                "sourcify",
                "--compilation-profile",
                manifest.schemaVersion === 3 ? "cca_via_ir" : "default",
                "--watch",
                checkedAddress,
                source,
              ],
              {
                cwd: contractsRoot,
                encoding: "utf8",
                // The verifier only uploads sources; it must not inherit
                // signing material.
                env: strippedOfSigningKeys(process.env),
                maxBuffer: 10 * 1024 * 1024,
              },
            ),
        );
        const output = `${verification.stdout ?? ""}${verification.stderr ?? ""}`;
        // Forge output can carry verifier URLs and request detail; in CI this
        // lands in a public build log, so it goes through the same redaction
        // as every other provider-facing diagnostic.
        process.stdout.write(redactDiagnostic(output));
        const exactMatch = sourceVerificationIsExact(
          verification.status,
          output,
        );
        yield* ensure(exactMatch, `Source verification failed for ${name}`);
        const jobId = output.match(/Verification Job ID: `([^`]+)`/)?.[1];
        const jobUrl = output.match(/URL: (https:\/\/\S+)/)?.[1];
        return {
          name,
          address: checkedAddress,
          source,
          status: "exact_match" as const,
          jobId,
          jobUrl,
          repositoryUrl,
          ...(priorBaseScanEvidence === undefined
            ? {}
            : {
                baseScanStatus: priorBaseScanEvidence.baseScanStatus,
                baseScanUrl: priorBaseScanEvidence.baseScanUrl,
                ...(typeof priorBaseScanEvidence.baseScanCheckedAt === "string"
                  ? {
                      baseScanCheckedAt:
                        priorBaseScanEvidence.baseScanCheckedAt,
                    }
                  : {}),
              }),
        };
      });
    const results = yield* Effect.forEach(
      Object.entries(sourceContracts) as Array<
        [keyof typeof sourceContracts, string]
      >,
      ([name, source]) => verifySource(name, source),
      { concurrency: 1 },
    );
    yield* fileSystem("Could not write source-verification evidence", () =>
      writeFileSync(
        evidencePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            chainId: 84_532,
            network: "base-sepolia",
            verifier: "Sourcify",
            contracts: results,
          },
          null,
          2,
        )}\n`,
      ),
    );
    process.stdout.write(
      `Exact source verification passed with evidence at ${evidencePath}\n`,
    );
  }),
);
