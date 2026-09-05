"use client";

import { modal } from "@reown/appkit/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useConnection, useSignMessage, useSwitchChain } from "wagmi";

import { ADMIN_AUTH_CHAIN_ID } from "@orbit/config/admin-auth";

import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { BrandMark, ShellSkipLink } from "@/components/shell/rail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { PageFrame, PageHeading } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { useReownConnectionFeedback } from "@/components/use-reown-connection-feedback";
import {
  AdminClientError,
  logoutAdminSession,
  requestAdminChallenge,
  verifyAdminSignature,
} from "@/lib/admin-auth-client";
import {
  AdminChallengeValidationError,
  type AdminReturnPath,
  validateAdminChallengeForSigning,
} from "@/lib/admin-session-contract";
import { publishAdminSessionStarted } from "@/lib/admin-session-teardown";
import {
  deploymentEnvironment,
  protocolDeploymentFingerprint,
} from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import { currentWalletConnection, isReownConfigured } from "@/lib/wagmi";

const compactAddress = (address: string): string =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
const invalidChallengeError =
  "Admin sign-in was stopped because the server challenge was invalid. Refresh and try again.";
const connectionChangedError =
  "Admin sign-in was stopped because the connected wallet or network changed. Reconnect the intended authority and try again.";

const isExpectedConnection = (
  connection: ReturnType<typeof currentWalletConnection>,
  address: `0x${string}`,
): connection is ReturnType<typeof currentWalletConnection> & {
  readonly address: `0x${string}`;
  readonly chainId: typeof ADMIN_AUTH_CHAIN_ID;
  readonly status: "connected";
} =>
  connection.status === "connected" &&
  connection.chainId === ADMIN_AUTH_CHAIN_ID &&
  connection.address === address;

class AdminSignInCancelled extends Error {}
class AdminConnectionChangedError extends Error {}

const requireCurrentConnection = (
  stillCurrent: () => boolean,
  address: `0x${string}`,
) => {
  if (!stillCurrent()) throw new AdminSignInCancelled();
  const activeConnection = currentWalletConnection();
  if (!isExpectedConnection(activeConnection, address)) {
    throw new AdminConnectionChangedError();
  }
  return activeConnection;
};

const sessionMatchesConnection = (
  session: Awaited<ReturnType<typeof verifyAdminSignature>>,
  connection: ReturnType<typeof requireCurrentConnection>,
): boolean =>
  session.address.toLowerCase() === connection.address.toLowerCase() &&
  session.chainId === connection.chainId &&
  protocolDeploymentFingerprint !== undefined &&
  session.deploymentFingerprint === protocolDeploymentFingerprint;

const signInErrorMessage = (reason: unknown): string => {
  if (reason instanceof AdminConnectionChangedError) {
    return connectionChangedError;
  }
  if (reason instanceof AdminChallengeValidationError) {
    return invalidChallengeError;
  }
  if (reason instanceof AdminClientError && reason.status === 403) {
    return "This wallet does not have a current operator role.";
  }
  return "Admin sign-in could not be completed. Check the wallet request and try again.";
};

type AdminSignInState =
  "idle" | "requesting" | "signing" | "verifying" | "rejected";

/**
 * The stage the access sequence has reached, derived from the same states the
 * controls render. It drives the visual stage rail only; every transition is
 * still announced by its own StateFeedback.
 */
const accessStages = [
  "Connect",
  "Network",
  "Signature",
  "Verification",
] as const;

const accessStage = (
  walletState: WalletVisualState,
  signInState: AdminSignInState,
): 1 | 2 | 3 | 4 => {
  if (walletState === "wrong-network" || walletState === "switching") return 2;
  if (walletState !== "connected") return 1;
  return signInState === "verifying" ? 4 : 3;
};

type WalletVisualState =
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "switching"
  | "rejected"
  | "connected";

type ConnectionStatus = ReturnType<typeof useConnection>["status"];

const adminWalletState = ({
  chainId,
  connectionRejected,
  status,
  switchRejected,
  switching,
}: {
  readonly chainId: number | undefined;
  readonly connectionRejected: boolean;
  readonly status: ConnectionStatus;
  readonly switchRejected: boolean;
  readonly switching: boolean;
}): WalletVisualState => {
  if (status !== "connected") {
    if (connectionRejected) return "rejected";
    return status === "disconnected" ? "disconnected" : "connecting";
  }
  if (chainId !== ADMIN_AUTH_CHAIN_ID) {
    if (switchRejected) return "rejected";
    return switching ? "switching" : "wrong-network";
  }
  return "connected";
};

const pendingAdminConnectionCopy = (status: ConnectionStatus) => {
  if (status === "connecting") {
    return {
      description: "Waiting for the wallet connection to finish.",
      label: "Connecting wallet…",
      reason: "Wait until the wallet connection finishes before continuing.",
      title: "Connecting wallet",
    } as const;
  }
  if (status === "reconnecting") {
    return {
      description: "Waiting for the previous wallet session to be restored.",
      label: "Restoring wallet…",
      reason:
        "Wait until the previous wallet session is restored before continuing.",
      title: "Restoring wallet session",
    } as const;
  }
  return undefined;
};

function DisconnectedAdminWalletControl({
  connectionRejected,
  onConnect,
  status,
}: {
  readonly connectionRejected: boolean;
  readonly onConnect: () => void;
  readonly status: ConnectionStatus;
}) {
  const pendingCopy = pendingAdminConnectionCopy(status);
  const connectionReason =
    pendingCopy !== undefined
      ? pendingCopy.reason
      : !isReownConfigured
        ? "Wallet connection is not configured for this deployment."
        : undefined;
  return (
    <>
      <Button
        aria-describedby={
          connectionReason === undefined
            ? undefined
            : "admin-wallet-connection-reason"
        }
        disabled={connectionReason !== undefined}
        onClick={onConnect}
        size="lg"
        type="button"
      >
        {pendingCopy?.label ?? "Connect wallet"}
      </Button>
      {connectionReason === undefined ? null : (
        <DisabledReason id="admin-wallet-connection-reason">
          {connectionReason}
        </DisabledReason>
      )}
      {pendingCopy === undefined ? null : (
        <StateFeedback
          compact
          description={pendingCopy.description}

          title={pendingCopy.title}
          tone="loading"
        />
      )}
      {connectionRejected ? (
        <StateFeedback
          compact
          description="The wallet connection was not approved. Try again when ready."

          title="Wallet connection was not completed"
          tone="error"
        />
      ) : null}
    </>
  );
}

function WrongNetworkAdminWalletControl({
  onSwitch,
  rejected,
  switching,
}: {
  readonly onSwitch: () => void;
  readonly rejected: boolean;
  readonly switching: boolean;
}) {
  return (
    <>
      <Button
        aria-describedby={switching ? "admin-wallet-network-reason" : undefined}
        disabled={switching}
        onClick={onSwitch}
        size="lg"
        type="button"
      >
        {switching
          ? "Switching network…"
          : `Switch to ${deploymentEnvironment.chainLabel}`}
      </Button>
      {switching ? (
        <DisabledReason id="admin-wallet-network-reason">
          Wait until the network request finishes before continuing.
        </DisabledReason>
      ) : null}
      {switching ? (
        <StateFeedback
          compact
          description="Confirm the requested network in your wallet."

          title="Switching network"
          tone="loading"
        />
      ) : null}
      {rejected ? (
        <StateFeedback
          compact
          description={`The wallet is still on the wrong network. Switch to ${deploymentEnvironment.chainLabel} and try again.`}

          title="Network switch was not completed"
          tone="error"
        />
      ) : null}
    </>
  );
}

const signInLabel = (state: AdminSignInState): string => {
  switch (state) {
    case "requesting":
      return "Preparing sign-in…";
    case "signing":
      return "Sign in your wallet…";
    case "verifying":
      return "Verifying authority…";
    case "rejected":
      return "Try admin sign-in again";
    case "idle":
      return "Sign in to admin";
  }
};

const pendingSignInReason = (state: AdminSignInState): string | undefined => {
  switch (state) {
    case "requesting":
      return "Sign-in is unavailable while the authority challenge is prepared.";
    case "signing":
      return "Sign-in is unavailable until the wallet signature request finishes.";
    case "verifying":
      return "Sign-in is unavailable while current authority roles are verified.";
    case "idle":
    case "rejected":
      return undefined;
  }
};

function ConnectedAdminWalletControl({
  address,
  onSignIn,
  signInState,
}: {
  readonly address: string;
  readonly onSignIn: () => void;
  readonly signInState: AdminSignInState;
}) {
  const reason = pendingSignInReason(signInState);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2">
        <span className="font-mono text-label tracking-[0.1em] text-ink-faint uppercase">
          Connected authority
        </span>
        <strong className="font-mono text-body-sm font-semibold text-ink tabular-nums">
          {compactAddress(address)}
        </strong>
      </div>
      <Button
        aria-describedby={
          reason === undefined ? undefined : "admin-sign-in-reason"
        }
        disabled={reason !== undefined}
        onClick={onSignIn}
        size="lg"
        type="button"
      >
        {signInLabel(signInState)}
      </Button>
      {reason === undefined ? null : (
        <DisabledReason id="admin-sign-in-reason">{reason}</DisabledReason>
      )}
    </>
  );
}

function AdminWalletControl({
  address,
  chainId,
  connectionRejected,
  onConnect,
  onSignIn,
  onSwitch,
  signInState,
  status,
  switchRejected,
  switching,
}: {
  readonly address: string | undefined;
  readonly chainId: number | undefined;
  readonly connectionRejected: boolean;
  readonly onConnect: () => void;
  readonly onSignIn: () => void;
  readonly onSwitch: () => void;
  readonly signInState: AdminSignInState;
  readonly status: ConnectionStatus;
  readonly switchRejected: boolean;
  readonly switching: boolean;
}) {
  if (status !== "connected") {
    return (
      <DisconnectedAdminWalletControl
        connectionRejected={connectionRejected}
        onConnect={onConnect}
        status={status}
      />
    );
  }
  if (chainId !== ADMIN_AUTH_CHAIN_ID) {
    return (
      <WrongNetworkAdminWalletControl
        onSwitch={onSwitch}
        rejected={switchRejected}
        switching={switching}
      />
    );
  }
  if (address === undefined) return null;
  return (
    <ConnectedAdminWalletControl
      address={address}
      onSignIn={onSignIn}
      signInState={signInState}
    />
  );
}

function AdminSignInFeedback({
  error,
  state,
}: {
  readonly error: string | undefined;
  readonly state: AdminSignInState;
}) {
  switch (state) {
    case "requesting":
      return (
        <StateFeedback
          compact
          description="Creating a deployment-bound challenge for this authority."

          title="Preparing authority challenge"
          tone="loading"
        />
      );
    case "signing":
      return (
        <StateFeedback
          compact
          description="Approve the signature request in your wallet. This is not a transaction."

          title="Signature requested"
          tone="loading"
        />
      );
    case "verifying":
      return (
        <StateFeedback
          compact
          description="Checking current onchain roles before any admin data is returned."

          title="Verifying authority"
          tone="loading"
        />
      );
    case "rejected":
      return error === undefined ? null : (
        <StateFeedback
          compact
          description={error}

          title="Admin sign-in rejected"
          tone="error"
        />
      );
    case "idle":
      return null;
  }
}

export function AdminSignIn({ next }: { readonly next: AdminReturnPath }) {
  const connection = useConnection();
  const router = useRouter();
  const signMessage = useSignMessage();
  const switchChain = useSwitchChain();
  const connectionFeedback = useReownConnectionFeedback();
  const [signInState, setSignInState] = useState<AdminSignInState>("idle");
  const [signInError, setSignInError] = useState<string>();
  const mounted = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const signIn = async () => {
    if (connection.status !== "connected") return;
    if (connection.chainId !== ADMIN_AUTH_CHAIN_ID) return;
    const attempt = generation.current + 1;
    generation.current = attempt;
    const stillCurrent = () =>
      mounted.current && generation.current === attempt;
    setSignInState("requesting");
    setSignInError(undefined);
    try {
      const challenge = await requestAdminChallenge(connection.address);
      const activeConnection = requireCurrentConnection(
        stillCurrent,
        connection.address,
      );
      const validatedChallenge = validateAdminChallengeForSigning(challenge, {
        address: activeConnection.address,
        appOrigin: window.location.origin,
        deploymentFingerprint: protocolDeploymentFingerprint,
        now: new Date(),
      });
      setSignInState("signing");
      const signature = await signMessage.mutateAsync({
        account: activeConnection.address,
        message: validatedChallenge.message,
      });
      requireCurrentConnection(stillCurrent, connection.address);
      setSignInState("verifying");
      const session = await verifyAdminSignature({
        message: validatedChallenge.message,
        signature,
      });
      try {
        const verifiedConnection = requireCurrentConnection(
          stillCurrent,
          connection.address,
        );
        if (!sessionMatchesConnection(session, verifiedConnection)) {
          throw new Error("Verified admin session does not match this client");
        }
      } catch (reason) {
        await logoutAdminSession(session.csrfToken);
        if (stillCurrent()) {
          setSignInState("rejected");
          setSignInError(signInErrorMessage(reason));
        }
        return;
      }
      publishAdminSessionStarted();
      router.replace(next);
      router.refresh();
    } catch (reason) {
      if (stillCurrent()) {
        setSignInState("rejected");
        setSignInError(signInErrorMessage(reason));
      }
    }
  };

  const connectWallet = () => {
    connectionFeedback.beginConnection();
    void Promise.resolve(modal?.open({ view: "Connect" })).catch(() =>
      connectionFeedback.failConnection(),
    );
  };

  const walletState = adminWalletState({
    chainId: connection.chainId,
    connectionRejected: connectionFeedback.rejected,
    status: connection.status,
    switchRejected: switchChain.isError,
    switching: switchChain.isPending,
  });

  return (
    <>
      <ShellSkipLink />
      <div className="min-h-dvh">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-1 px-4 tablet:px-6">
          <BrandMark context={applicationCopy.shell.operatorConsole} href="/" />
          <nav aria-label="Public navigation">
            <ul className="flex flex-wrap items-center gap-x-5">
              <li>
                <Link
                  className="flex min-h-11 items-center font-mono text-label tracking-[0.1em] text-ink-soft uppercase transition-colors duration-[var(--motion-fast)] hover:text-ink motion-reduce:transition-none"
                  href="/status"
                >
                  {applicationCopy.shell.publicStatusNavigation}
                </Link>
              </li>
              <li>
                <Link
                  className="flex min-h-11 items-center font-mono text-label tracking-[0.1em] text-ink-soft uppercase transition-colors duration-[var(--motion-fast)] hover:text-ink motion-reduce:transition-none"
                  href="/"
                >
                  {applicationCopy.shell.collectorAppNavigation}
                </Link>
              </li>
            </ul>
          </nav>
        </header>

        <PageFrame>
          <PageHeading
            eyebrow="Admin boundary"
            lede={`Access is checked against ${deploymentEnvironment.chainLabel} at the moment you sign in.`}
            title={applicationCopy.shell.operatorConsole}
          />
          <div className="mt-4 grid gap-3 laptop:grid-cols-2">
            <Panel title="Console access">
              <DataList>
                <DataRow
                  label="Current chain"
                  value={deploymentEnvironment.chainLabel}
                />
                <DataRow label="Authorization" value="Live onchain roles" />
                <DataRow label="Session" value="Short-lived and host-only" />
              </DataList>
              {/* The stage rail mirrors the states announced in the panel
                  beside it; it is a visual instrument only, so it is hidden
                  from screen readers. */}
              <ol
                aria-hidden="true"
                className="mt-4 flex flex-wrap items-center gap-1.5"
                data-access-stage={accessStage(walletState, signInState)}
              >
                {accessStages.map((label, index) => (
                  <li key={label}>
                    <Badge
                      dot
                      tone={
                        index + 1 === accessStage(walletState, signInState)
                          ? "live"
                          : "neutral"
                      }
                    >
                      {label}
                    </Badge>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Operator sign-in" tone="live">
              <div
                className="flex flex-col gap-3"
                data-admin-sign-in-state={signInState}
              >
                <p className="text-body-sm text-ink-soft">
                  Connect the authority wallet and sign a deployment-bound
                  message. The server verifies its current role before returning
                  admin data.
                </p>
                <div
                  className="flex flex-col gap-2"
                  data-wallet-state={walletState}
                >
                  <AdminWalletControl
                    address={connection.address}
                    chainId={connection.chainId}
                    connectionRejected={connectionFeedback.rejected}
                    onConnect={connectWallet}
                    onSignIn={() => void signIn()}
                    onSwitch={() =>
                      switchChain.mutate({ chainId: ADMIN_AUTH_CHAIN_ID })
                    }
                    signInState={signInState}
                    status={connection.status}
                    switchRejected={switchChain.isError}
                    switching={switchChain.isPending}
                  />
                  <AdminSignInFeedback
                    error={signInError}
                    state={signInState}
                  />
                </div>
                <StateFeedback
                  compact
                  description="It spends no gas and grants no new onchain permission."
                  title="This signature is not a transaction"
                  tone="notice"
                />
              </div>
            </Panel>
          </div>
        </PageFrame>
      </div>
    </>
  );
}
