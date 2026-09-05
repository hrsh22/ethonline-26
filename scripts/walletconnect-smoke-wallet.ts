import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { WalletKit } from "@reown/walletkit";
import type { WalletKitTypes } from "@reown/walletkit";
import { Core } from "@walletconnect/core";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import { decodeProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { Effect, Schema } from "effect";
import {
  createWalletClient,
  decodeFunctionData,
  getAddress,
  hexToString,
  http,
  isHex,
  parseAbi,
  parseEther,
} from "viem";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { parseSiweMessage } from "viem/siwe";

import {
  decodeEnvironment,
  ensure,
  fileSystem,
  requireAddresses,
  rpc,
  runMain,
  validate,
} from "./effect-runtime.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const WalletEnvironmentSchema = Schema.Struct({
  NEXT_PUBLIC_REOWN_PROJECT_ID: NonEmptyString,
  WALLETCONNECT_URI: NonEmptyString,
  SMOKE_WALLET_PRIVATE_KEY: Schema.optional(NonEmptyString),
  SMOKE_WALLET_CHAIN_ID: Schema.optionalWith(NonEmptyString, {
    default: () => "84532",
  }),
  SMOKE_WALLET_EMIT_CHAIN_ID: Schema.optional(NonEmptyString),
  SMOKE_WALLET_ALLOW_TRANSACTIONS: Schema.optionalWith(
    Schema.BooleanFromString,
    { default: () => false },
  ),
  SMOKE_WALLET_ALLOW_ADMIN_SIGN_IN: Schema.optionalWith(
    Schema.BooleanFromString,
    { default: () => false },
  ),
  SMOKE_WALLET_POST_SIGN_ACCOUNT_SWITCH: Schema.optionalWith(
    Schema.BooleanFromString,
    { default: () => false },
  ),
  SMOKE_WALLET_POST_SIGN_CHAIN_ID: Schema.optional(NonEmptyString),
  BASE_SEPOLIA_RPC_URL: Schema.optional(NonEmptyString),
  SMOKE_WALLET_ALLOWED_DAPP_NAME: Schema.optionalWith(NonEmptyString, {
    default: () => "ORBIT 4444",
  }),
  SMOKE_WALLET_ALLOWED_DAPP_URL: Schema.optionalWith(NonEmptyString, {
    default: () => "http://localhost:3000",
  }),
  SMOKE_WALLET_ALLOWED_ACTIONS: Schema.optionalWith(Schema.String, {
    default: () => "",
  }),
});

const parseOptionalNumber = (value: string | undefined) =>
  value === undefined ? undefined : Number(value);

const validOptionalPositiveInteger = (value: number | undefined): boolean =>
  value === undefined || (Number.isSafeInteger(value) && value > 0);

const selectPrivateKey = (requested: string | undefined) =>
  requested === undefined ? generatePrivateKey() : requested;

const selectChainId = (emitted: number | undefined, fallback: number) =>
  emitted === undefined ? fallback : emitted;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const valueOrFallback = <Value>(value: Value | undefined, fallback: Value) =>
  value === undefined ? fallback : value;

runMain(
  Effect.gen(function* () {
    const environment = yield* decodeEnvironment(
      WalletEnvironmentSchema,
      "WalletConnect smoke environment is invalid",
    );
    const projectId = environment.NEXT_PUBLIC_REOWN_PROJECT_ID;
    const pairingUri = environment.WALLETCONNECT_URI;
    const requestedPrivateKey = environment.SMOKE_WALLET_PRIVATE_KEY;
    const chainId = Number(environment.SMOKE_WALLET_CHAIN_ID);
    const emittedChainIdText = environment.SMOKE_WALLET_EMIT_CHAIN_ID;
    const emittedChainId = parseOptionalNumber(emittedChainIdText);
    const allowTransactions = environment.SMOKE_WALLET_ALLOW_TRANSACTIONS;
    const allowAdminSignIn = environment.SMOKE_WALLET_ALLOW_ADMIN_SIGN_IN;
    const postSignAccountSwitch =
      environment.SMOKE_WALLET_POST_SIGN_ACCOUNT_SWITCH;
    const postSignChainId = parseOptionalNumber(
      environment.SMOKE_WALLET_POST_SIGN_CHAIN_ID,
    );
    const rpcUrl = environment.BASE_SEPOLIA_RPC_URL;
    const allowedDappName = environment.SMOKE_WALLET_ALLOWED_DAPP_NAME;
    const allowedDappUrl = environment.SMOKE_WALLET_ALLOWED_DAPP_URL;
    type SupportedAction =
      | "approve"
      | "trade"
      | "commit"
      | "claim"
      | "open-epoch"
      | "execute-track"
      | "pol";
    const allowedActions = new Set(
      environment.SMOKE_WALLET_ALLOWED_ACTIONS.split(",")
        .map((action) => action.trim())
        .filter(Boolean),
    );
    const supportedActions = new Set<SupportedAction>([
      "approve",
      "trade",
      "commit",
      "claim",
      "open-epoch",
      "execute-track",
      "pol",
    ]);
    const isSupportedAction = (action: string): action is SupportedAction =>
      supportedActions.has(action as SupportedAction);

    yield* ensure(
      pairingUri.startsWith("wc:"),
      "WALLETCONNECT_URI must contain a WalletConnect pairing URI",
    );
    yield* ensure(
      Number.isSafeInteger(chainId) && chainId > 0,
      "SMOKE_WALLET_CHAIN_ID must be a positive integer",
    );
    yield* ensure(
      validOptionalPositiveInteger(emittedChainId),
      "SMOKE_WALLET_EMIT_CHAIN_ID must be a positive integer",
    );
    yield* ensure(
      validOptionalPositiveInteger(postSignChainId),
      "SMOKE_WALLET_POST_SIGN_CHAIN_ID must be a positive integer",
    );
    yield* ensure(
      !postSignAccountSwitch || postSignChainId === undefined,
      "Configure only one post-sign wallet mutation",
    );
    yield* ensure(
      !allowTransactions ||
        (chainId === baseSepolia.id && rpcUrl !== undefined),
      "Transaction-enabled smoke wallets require Base Sepolia and BASE_SEPOLIA_RPC_URL",
    );
    yield* ensure(
      !allowTransactions ||
        (allowedActions.size !== 0 &&
          ![...allowedActions].some((action) => !isSupportedAction(action))),
      "Transaction-enabled smoke wallets require an explicit, valid SMOKE_WALLET_ALLOWED_ACTIONS policy",
    );
    yield* ensure(
      requestedPrivateKey === undefined ||
        /^0x[0-9a-fA-F]{64}$/.test(requestedPrivateKey),
      "SMOKE_WALLET_PRIVATE_KEY must be a 32-byte hex value",
    );

    const account = yield* validate("Smoke wallet private key is invalid", () =>
      privateKeyToAccount(selectPrivateKey(requestedPrivateKey) as Hex),
    );
    const postSignAccount = postSignAccountSwitch
      ? privateKeyToAccount(generatePrivateKey())
      : undefined;
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const deploymentText = yield* fileSystem(
      "Could not read the Base Sepolia deployment manifest",
      () =>
        readFileSync(join(repositoryRoot, "deployments/84532.json"), "utf8"),
    );
    const deployment = yield* validate("Deployment manifest is invalid", () =>
      decodeProtocolDeploymentManifest(JSON.parse(deploymentText) as unknown),
    );
    const contracts = yield* validate(
      "Deployment manifest is missing WalletConnect smoke contracts",
      () =>
        requireAddresses(deployment.contracts, [
          "canonicalRouter",
          "epochConverter",
          "fuelCore",
          "protocolLiquidityVault",
          "rewardLedger",
          "weth",
        ] as const),
    );
    const walletClient = allowTransactions
      ? createWalletClient({
          account,
          chain: baseSepolia,
          transport: http(rpcUrl),
        })
      : undefined;
    const caipChain = `eip155:${chainId}`;
    const caipAccount = `${caipChain}:${account.address}`;
    let activeChainId = selectChainId(emittedChainId, chainId);
    const methods = [
      "eth_accounts",
      "eth_requestAccounts",
      "eth_sendTransaction",
      "eth_sign",
      "personal_sign",
      "eth_signTypedData",
      "eth_signTypedData_v4",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ];
    const events = ["accountsChanged", "chainChanged"];
    const approvedTopics = new Set();

    const erc20Abi = parseAbi([
      "function approve(address spender,uint256 amount) returns (bool)",
    ]);
    const routerAbi = parseAbi([
      "function swapExactInput((bool fuelForWeth,uint256 amountIn,uint256 amountOutMinimum,address recipient,uint256 deadline,bool useNative) params) payable returns (uint256 amountOut)",
    ]);
    const fuelAbi = parseAbi(["function commit(uint16 identityId)"]);
    const ledgerAbi = parseAbi(["function claim(uint16[] identityIds)"]);
    const converterAbi = parseAbi([
      "function openRewardEpoch() returns (uint256)",
      "function executeTrack(uint8 track,uint256 minimumStockOutput,uint256 deadline) returns (uint256)",
    ]);
    const liquidityAbi = parseAbi([
      "function addLiquidityCycle(int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 maximumWeth,uint256 deadline) returns (uint256)",
    ]);
    const normalizedUrl = (url: string): string =>
      new URL(url).href.replace(/\/$/, "");
    const sameAddress = (left: unknown, right: unknown): boolean =>
      typeof left === "string" &&
      typeof right === "string" &&
      left.toLowerCase() === right.toLowerCase();
    const decodePersonalSignParams = (
      params: unknown,
    ): { readonly message: string; readonly messageInput: string } => {
      if (!Array.isArray(params) || params.length < 2) {
        throw new Error("personal_sign requires a message and account");
      }
      const [firstInput, secondInput] = params;
      const addressInput = sameAddress(firstInput, account.address)
        ? firstInput
        : secondInput;
      const messageInput = sameAddress(firstInput, account.address)
        ? secondInput
        : firstInput;
      if (
        typeof messageInput !== "string" ||
        !sameAddress(addressInput, account.address)
      ) {
        throw new Error(
          "personal_sign account does not match the smoke wallet",
        );
      }
      return {
        message: isHex(messageInput) ? hexToString(messageInput) : messageInput,
        messageInput,
      };
    };
    const isExpectedAdminMessage = (message: string): boolean => {
      try {
        const appOrigin = new URL(allowedDappUrl);
        const parsed = parseSiweMessage(message);
        return (
          parsed.domain === appOrigin.host &&
          sameAddress(parsed.address, account.address) &&
          parsed.statement ===
            "Authorize access to the Orbit administrator console." &&
          parsed.uri === new URL("/admin/sign-in", appOrigin).toString() &&
          parsed.chainId === chainId
        );
      } catch {
        return false;
      }
    };
    interface SmokeTransaction {
      readonly from: string;
      readonly to: Address;
      readonly data: Hex;
      readonly value?: string | undefined;
      readonly gas?: string | undefined;
      readonly gasPrice?: string | undefined;
      readonly maxFeePerGas?: string | undefined;
      readonly maxPriorityFeePerGas?: string | undefined;
      readonly nonce?: string | undefined;
    }
    const smokeTransactionSchema = Schema.Struct({
      from: Schema.String,
      to: Schema.String,
      data: Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]*$/)),
      value: Schema.optional(Schema.String),
      gas: Schema.optional(Schema.String),
      gasPrice: Schema.optional(Schema.String),
      maxFeePerGas: Schema.optional(Schema.String),
      maxPriorityFeePerGas: Schema.optional(Schema.String),
      nonce: Schema.optional(Schema.String),
    });
    const transactionValue = (transaction: SmokeTransaction): bigint =>
      transaction.value === undefined ? 0n : BigInt(transaction.value);
    const requireAction = (action: SupportedAction): void => {
      if (!allowedActions.has(action)) {
        throw new Error(`Smoke wallet action ${action} is not enabled`);
      }
    };
    const requireDeadline = (deadline: bigint): void => {
      const now = BigInt(Math.floor(Date.now() / 1_000));
      const value = BigInt(deadline);
      if (value < now - 120n || value > now + 3_600n) {
        throw new Error(
          "Smoke wallet transaction deadline is outside its test window",
        );
      }
    };
    const decodeTransaction = (input: unknown): SmokeTransaction => {
      const decoded = Schema.decodeUnknownSync(smokeTransactionSchema)(input);
      return {
        ...decoded,
        to: getAddress(decoded.to),
        data: decoded.data as Hex,
      };
    };
    const validateApproval = (
      transaction: SmokeTransaction,
    ): SmokeTransaction | undefined => {
      const tokenTarget = [contracts.weth, contracts.fuelCore].some((address) =>
        sameAddress(transaction.to, address),
      );
      if (!tokenTarget) return undefined;
      try {
        const decoded = decodeFunctionData({
          abi: erc20Abi,
          data: transaction.data,
        });
        if (decoded.functionName !== "approve") return undefined;
        requireAction("approve");
        const safeApproval =
          sameAddress(decoded.args[0], contracts.canonicalRouter) &&
          BigInt(decoded.args[1]) > 0n &&
          transactionValue(transaction) === 0n;
        if (!safeApproval) {
          throw new Error("Smoke wallet rejected an unsafe approval");
        }
        return transaction;
      } catch (cause) {
        const policyError =
          cause instanceof Error && cause.message.startsWith("Smoke wallet");
        if (policyError) throw cause;
        return undefined;
      }
    };
    const validateTrade = (transaction: SmokeTransaction) => {
      requireAction("trade");
      const decoded = decodeFunctionData({
        abi: routerAbi,
        data: transaction.data,
      });
      const params = decoded.args[0];
      requireDeadline(params.deadline);
      const expectedValue = params.useNative ? params.amountIn : 0n;
      const safeTrade =
        sameAddress(params.recipient, account.address) &&
        params.amountIn > 0n &&
        params.amountIn <= parseEther("2") &&
        transactionValue(transaction) === expectedValue;
      if (!safeTrade) {
        throw new Error("Smoke wallet rejected unsafe trade parameters");
      }
      return transaction;
    };
    const validateCommit = (transaction: SmokeTransaction) => {
      requireAction("commit");
      const decoded = decodeFunctionData({
        abi: fuelAbi,
        data: transaction.data,
      });
      const identityId = Number(decoded.args[0]);
      const safeCommit =
        decoded.functionName === "commit" &&
        Number.isInteger(identityId) &&
        identityId >= 1 &&
        identityId <= 4_444 &&
        transactionValue(transaction) === 0n;
      if (!safeCommit) {
        throw new Error("Smoke wallet rejected unsafe Commitment parameters");
      }
      return transaction;
    };
    const validateClaim = (transaction: SmokeTransaction) => {
      requireAction("claim");
      const decoded = decodeFunctionData({
        abi: ledgerAbi,
        data: transaction.data,
      });
      const identityIds = decoded.args[0];
      const identitiesInRange = identityIds.every(
        (identityId) => identityId >= 1 && identityId <= 4_444,
      );
      const safeClaim =
        decoded.functionName === "claim" &&
        identityIds.length > 0 &&
        identityIds.length <= 64 &&
        identitiesInRange &&
        transactionValue(transaction) === 0n;
      if (!safeClaim) {
        throw new Error("Smoke wallet rejected unsafe claim parameters");
      }
      return transaction;
    };
    const validateConverterAction = (transaction: SmokeTransaction) => {
      const decoded = decodeFunctionData({
        abi: converterAbi,
        data: transaction.data,
      });
      if (decoded.functionName === "openRewardEpoch") {
        requireAction("open-epoch");
      } else if (decoded.functionName === "executeTrack") {
        requireAction("execute-track");
        const track = Number(decoded.args[0]);
        if (!Number.isInteger(track) || track < 1 || track > 4) {
          throw new Error("Smoke wallet rejected an invalid Reward Track");
        }
        requireDeadline(decoded.args[2]);
      } else {
        throw new Error("Smoke wallet rejected an unknown converter action");
      }
      if (transactionValue(transaction) !== 0n) {
        throw new Error("Smoke wallet rejected converter transaction value");
      }
      return transaction;
    };
    const validateLiquidityAction = (transaction: SmokeTransaction) => {
      requireAction("pol");
      const decoded = decodeFunctionData({
        abi: liquidityAbi,
        data: transaction.data,
      });
      const [, , liquidity, maximumWeth, deadline] = decoded.args;
      requireDeadline(deadline);
      const safeLiquidityAction =
        decoded.functionName === "addLiquidityCycle" &&
        liquidity > 0n &&
        maximumWeth > 0n &&
        maximumWeth <= parseEther("0.1") &&
        transactionValue(transaction) === 0n;
      if (!safeLiquidityAction) {
        throw new Error("Smoke wallet rejected unsafe POL parameters");
      }
      return transaction;
    };
    const transactionPolicies = [
      { address: contracts.canonicalRouter, validate: validateTrade },
      { address: contracts.fuelCore, validate: validateCommit },
      { address: contracts.rewardLedger, validate: validateClaim },
      { address: contracts.epochConverter, validate: validateConverterAction },
      {
        address: contracts.protocolLiquidityVault,
        validate: validateLiquidityAction,
      },
    ] as const;
    const validateTransaction = (input: unknown): SmokeTransaction => {
      const transaction = decodeTransaction(input);
      if (!sameAddress(transaction.from, account.address)) {
        throw new Error("WalletConnect transaction envelope is invalid");
      }
      const approval = validateApproval(transaction);
      if (approval !== undefined) return approval;
      const policy = transactionPolicies.find(({ address }) =>
        sameAddress(transaction.to, address),
      );
      if (policy === undefined) {
        throw new Error(
          "Smoke wallet rejected a transaction outside its action policy",
        );
      }
      return policy.validate(transaction);
    };
    yield* rpc("WalletConnect smoke session failed", async () => {
      const core = new Core({
        customStoragePrefix: `base-quotron-smoke-${account.address.toLowerCase()}-${Date.now()}`,
        projectId,
        telemetryEnabled: false,
      });
      const wallet = await WalletKit.init({
        core: core as unknown as WalletKitTypes.Options["core"],
        metadata: {
          name: "Base Quotron smoke wallet",
          description:
            "Ephemeral WalletConnect peer for browser acceptance testing",
          url: "http://localhost:3000",
          icons: [],
        },
      });

      const proposalIsAllowed = (
        metadata: { readonly name: string; readonly url: string },
        requestedChains: readonly string[],
      ) =>
        metadata.name === allowedDappName &&
        normalizedUrl(metadata.url) === normalizedUrl(allowedDappUrl) &&
        requestedChains.every((requestedChain) => requestedChain === caipChain);
      type ApprovedSession = Awaited<ReturnType<typeof wallet.approveSession>>;
      const emitChain = async (
        session: ApprovedSession,
        nextChainId: number,
      ) => {
        const emittedCaipChain = `eip155:${nextChainId}`;
        const evmNamespace = session.namespaces.eip155;
        const existingAccounts = valueOrFallback(evmNamespace?.accounts, []);
        const existingChains = valueOrFallback(evmNamespace?.chains, []);
        const existingEvents = valueOrFallback(evmNamespace?.events, events);
        const existingMethods = valueOrFallback(evmNamespace?.methods, methods);
        const update = await wallet.updateSession({
          topic: session.topic,
          namespaces: {
            ...session.namespaces,
            eip155: {
              ...evmNamespace,
              accounts: [
                ...new Set([
                  ...existingAccounts,
                  `${emittedCaipChain}:${account.address}`,
                ]),
              ],
              chains: [...new Set([...existingChains, emittedCaipChain])],
              events: existingEvents,
              methods: existingMethods,
            },
          },
        });
        await update.acknowledged();
        activeChainId = nextChainId;
        await wallet.emitSessionEvent({
          topic: session.topic,
          event: {
            name: "chainChanged",
            data: `0x${nextChainId.toString(16)}`,
          },
          chainId: emittedCaipChain,
        });
        console.log(`Emitted wallet chain ${nextChainId}`);
      };
      const emitConfiguredChain = async (session: ApprovedSession) => {
        if (emittedChainId !== undefined) {
          await emitChain(session, emittedChainId);
        }
      };
      const emitPostSignMutation = async (topic: string) => {
        const session = wallet.getActiveSessions()[topic];
        if (session === undefined) return;
        if (postSignChainId !== undefined) {
          await emitChain(session, postSignChainId);
          return;
        }
        if (postSignAccount === undefined) return;
        const evmNamespace = session.namespaces.eip155;
        const update = await wallet.updateSession({
          topic,
          namespaces: {
            ...session.namespaces,
            eip155: {
              ...evmNamespace,
              accounts: [`${caipChain}:${postSignAccount.address}`],
              chains: valueOrFallback(evmNamespace?.chains, [caipChain]),
              events: valueOrFallback(evmNamespace?.events, events),
              methods: valueOrFallback(evmNamespace?.methods, methods),
            },
          },
        });
        await update.acknowledged();
        await wallet.emitSessionEvent({
          topic,
          event: { name: "accountsChanged", data: [postSignAccount.address] },
          chainId: caipChain,
        });
        console.log(`Emitted wallet account ${postSignAccount.address}`);
      };
      const schedulePostSignMutation = (
        method: string,
        result: unknown,
        topic: string,
      ) => {
        if (method !== "personal_sign" || result === undefined) return;
        setTimeout(() => {
          void emitPostSignMutation(topic).catch((error: unknown) =>
            console.error(
              `Could not emit post-sign wallet mutation: ${errorMessage(error)}`,
            ),
          );
        }, 1_500);
      };

      wallet.on("session_proposal", async (proposal) => {
        try {
          const metadata = proposal.params.proposer.metadata;
          const requestedChains = Object.values(
            proposal.params.requiredNamespaces ?? {},
          ).flatMap((namespace) => namespace.chains ?? []);
          if (!proposalIsAllowed(metadata, requestedChains)) {
            await wallet.rejectSession({
              id: proposal.id,
              reason: getSdkError("USER_REJECTED"),
            });
            console.error(
              "Rejected WalletConnect proposal outside the smoke policy",
            );
            return;
          }
          const namespaces = buildApprovedNamespaces({
            proposal: proposal.params,
            supportedNamespaces: {
              eip155: {
                accounts: [caipAccount],
                chains: [caipChain],
                events,
                methods,
              },
            },
          });
          const session = await wallet.approveSession({
            id: proposal.id,
            namespaces,
          });
          approvedTopics.add(session.topic);
          console.log(
            `Connected smoke wallet ${account.address} on chain ${chainId}`,
          );
          await emitConfiguredChain(session);
        } catch (error) {
          console.error(
            `Could not approve the WalletConnect session: ${errorMessage(error)}`,
          );
        }
      });

      const requestedChainId = (params: unknown) => {
        if (!Array.isArray(params)) return undefined;
        const request = params[0] as { readonly chainId?: unknown } | undefined;
        if (typeof request?.chainId !== "string") return undefined;
        return Number(BigInt(request.chainId));
      };
      const switchSessionChain = async (topic: string, params: unknown) => {
        if (requestedChainId(params) !== baseSepolia.id) {
          throw new Error(
            "Smoke wallet only supports Base Sepolia chain 84532",
          );
        }
        const session = wallet.getActiveSessions()[topic];
        if (session === undefined) {
          throw new Error("WalletConnect session is no longer active");
        }
        const evmNamespace = session.namespaces.eip155;
        const namespaceEvents =
          evmNamespace === undefined ? events : evmNamespace.events;
        const namespaceMethods =
          evmNamespace === undefined ? methods : evmNamespace.methods;
        const update = await wallet.updateSession({
          topic,
          namespaces: {
            ...session.namespaces,
            eip155: {
              ...evmNamespace,
              accounts: [caipAccount],
              chains: [caipChain],
              events: namespaceEvents,
              methods: namespaceMethods,
            },
          },
        });
        await update.acknowledged();
        activeChainId = baseSepolia.id;
        await wallet.emitSessionEvent({
          topic,
          event: {
            name: "chainChanged",
            data: `0x${baseSepolia.id.toString(16)}`,
          },
          chainId: caipChain,
        });
        return null;
      };
      const sendRequest = (transaction: SmokeTransaction) =>
        ({
          account,
          chain: baseSepolia,
          data: transaction.data,
          to: transaction.to,
          ...(transaction.gas === undefined
            ? {}
            : { gas: BigInt(transaction.gas) }),
          ...(transaction.gasPrice === undefined
            ? {}
            : { gasPrice: BigInt(transaction.gasPrice) }),
          ...(transaction.maxFeePerGas === undefined
            ? {}
            : { maxFeePerGas: BigInt(transaction.maxFeePerGas) }),
          ...(transaction.maxPriorityFeePerGas === undefined
            ? {}
            : {
                maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
              }),
          ...(transaction.nonce === undefined
            ? {}
            : { nonce: Number(BigInt(transaction.nonce)) }),
          ...(transaction.value === undefined
            ? {}
            : { value: BigInt(transaction.value) }),
        }) as unknown as Parameters<
          NonNullable<typeof walletClient>["sendTransaction"]
        >[0];
      const sendSmokeTransaction = async (
        requestChainId: string,
        params: unknown,
      ) => {
        if (walletClient === undefined) return undefined;
        const activeBaseSepolia =
          requestChainId === caipChain && activeChainId === baseSepolia.id;
        if (!activeBaseSepolia) {
          throw new Error("Smoke transactions require active Base Sepolia");
        }
        const transactionInput = Array.isArray(params) ? params[0] : undefined;
        const transaction = validateTransaction(transactionInput);
        const result = await walletClient.sendTransaction(
          sendRequest(transaction),
        );
        console.log(`Broadcast smoke transaction ${result}`);
        return result;
      };

      const signAdminMessage = async (params: unknown) => {
        if (!allowAdminSignIn) return undefined;
        const { message, messageInput } = decodePersonalSignParams(params);
        if (!isExpectedAdminMessage(message)) {
          throw new Error(
            "personal_sign message is not the expected deployment-bound admin challenge",
          );
        }
        return account.signMessage({
          message: isHex(messageInput)
            ? { raw: messageInput as Hex }
            : messageInput,
        });
      };

      wallet.on("session_request", async (event) => {
        const { method, params } = event.params.request;
        console.log(`Received WalletConnect request ${method}`);
        let result;
        try {
          if (!approvedTopics.has(event.topic)) {
            throw new Error(
              "WalletConnect session was not approved by the smoke policy",
            );
          }
          if (method === "eth_accounts" || method === "eth_requestAccounts") {
            result = [account.address];
          } else if (method === "wallet_switchEthereumChain") {
            result = await switchSessionChain(event.topic, params);
          } else if (method === "eth_sendTransaction") {
            result = await sendSmokeTransaction(event.params.chainId, params);
          } else if (method === "personal_sign") {
            result = await signAdminMessage(params);
          }
        } catch (error) {
          console.error(
            `Rejected WalletConnect request ${method}: ${errorMessage(error)}`,
          );
          await wallet.respondSessionRequest({
            topic: event.topic,
            response: {
              id: event.id,
              jsonrpc: "2.0",
              error: {
                code: -32_000,
                message: errorMessage(error),
              },
            },
          });
          return;
        }
        await wallet.respondSessionRequest({
          topic: event.topic,
          response:
            result !== undefined
              ? { id: event.id, jsonrpc: "2.0", result }
              : {
                  id: event.id,
                  jsonrpc: "2.0",
                  error: {
                    code: 4001,
                    message: `${method} is intentionally disabled in the browser smoke wallet`,
                  },
                },
        });
        schedulePostSignMutation(method, result, event.topic);
      });

      wallet.on("session_delete", () => {
        approvedTopics.clear();
        console.log("WalletConnect smoke session disconnected");
      });

      console.log(
        `Pairing smoke wallet ${account.address} on chain ${chainId}`,
      );
      await wallet.pair({ uri: pairingUri });
      await new Promise(() => {});
    });
  }),
);
