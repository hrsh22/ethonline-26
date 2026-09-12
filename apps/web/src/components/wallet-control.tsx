"use client";

import { ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { type ReactNode, useId } from "react";
import { useConnection, useSwitchChain } from "wagmi";

import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { Button } from "@/components/ui/button";
import { WalletConnectionAction } from "@/components/wallet-connection-action";
import { useOptionalAdminSession } from "@/components/admin/admin-session-boundary";
import { deploymentEnvironment } from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import { isWalletConfigured, protocolChain } from "@/lib/wagmi";
import {
  useWalletSession,
  type WalletSession,
} from "@/providers/wallet-session";

const compactAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

type WalletVisualState =
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "switching"
  | "rejected"
  | "connected";

type AdminSession = ReturnType<typeof useOptionalAdminSession>;
type ConnectionStatus = ReturnType<typeof useConnection>["status"];
type FeedbackSurface = "default" | "inverse";

function WalletStateFrame({
  children,
  state,
}: {
  readonly children: ReactNode;
  readonly state: WalletVisualState;
}) {
  return (
    <div
      className="wallet-session wallet-control-state flex min-w-0 flex-wrap items-center gap-2 laptop:flex-col laptop:items-stretch"
      data-wallet-state={state}
    >
      {children}
    </div>
  );
}

function AdminSignOut({ session }: { readonly session: AdminSession }) {
  if (session === undefined) return null;
  return (
    <Button
      onClick={() => void session.endSession()}
      size="sm"
      type="button"
      variant="ghost"
    >
      {applicationCopy.shell.signOut}
    </Button>
  );
}

const connectionReason = (
  status: ConnectionStatus,
  configured: boolean,
): string | undefined => {
  if (status === "reconnecting")
    return "Restoring the previous wallet session.";
  if (status === "connecting") {
    return "Waiting for the wallet connection to finish.";
  }
  if (!configured) {
    return "Wallet connection is not configured for this deployment.";
  }
  return undefined;
};

const connectionLabel = (status: ConnectionStatus): string => {
  if (status === "reconnecting") return "Restoring wallet";
  if (status === "connecting") return "Connecting wallet";
  return applicationCopy.shell.connectWallet;
};

const connectionVisualState = (
  status: ConnectionStatus,
  rejected: boolean,
): WalletVisualState => {
  if (rejected) return "rejected";
  return status === "disconnected" ? "disconnected" : "connecting";
};

function ConnectionWalletControl({
  adminSession,
  configured,
  notices,
  onConnect,
  reasonId,
  rejected,
  status,
  surface,
}: {
  readonly adminSession: AdminSession;
  readonly configured: boolean;
  readonly notices: boolean;
  readonly onConnect: () => void;
  readonly reasonId: string;
  readonly rejected: boolean;
  readonly status: ConnectionStatus;
  readonly surface: FeedbackSurface;
}) {
  const reason = connectionReason(status, configured);
  return (
    <WalletStateFrame state={connectionVisualState(status, rejected)}>
      <WalletConnectionAction
        ariaDescribedBy={
          reason === undefined || !notices ? undefined : reasonId
        }
        className="wallet-button"
        disabled={reason !== undefined}
        onContinue={onConnect}
      >
        {connectionLabel(status)}
      </WalletConnectionAction>
      {reason === undefined || !notices ? null : (
        <DisabledReason id={reasonId} surface={surface}>
          {reason}
        </DisabledReason>
      )}
      {rejected && notices ? (
        <StateFeedback
          compact
          description="The wallet connection did not finish. Open your wallet and try again when ready."
          surface={surface}
          title="Wallet connection not completed"
          tone="error"
        />
      ) : null}
      <AdminSignOut session={adminSession} />
    </WalletStateFrame>
  );
}

const networkVisualState = (
  switching: boolean,
  rejected: boolean,
): WalletVisualState => {
  if (rejected) return "rejected";
  return switching ? "switching" : "wrong-network";
};

function WrongNetworkWalletControl({
  adminSession,
  notices,
  onSwitch,
  reasonId,
  rejected,
  switching,
  surface,
}: {
  readonly adminSession: AdminSession;
  readonly notices: boolean;
  readonly onSwitch: () => void;
  readonly reasonId: string;
  readonly rejected: boolean;
  readonly switching: boolean;
  readonly surface: FeedbackSurface;
}) {
  return (
    <WalletStateFrame state={networkVisualState(switching, rejected)}>
      <Button
        aria-describedby={switching && notices ? reasonId : undefined}
        className="wallet-button"
        disabled={switching}
        onClick={onSwitch}
        type="button"
        variant={surface === "inverse" ? "default" : "outline"}
      >
        {switching
          ? "Switching network"
          : `Switch to ${deploymentEnvironment.chainLabel}`}
      </Button>
      {switching && notices ? (
        <DisabledReason id={reasonId} surface={surface}>
          Confirm the network change in your wallet.
        </DisabledReason>
      ) : null}
      {rejected && notices ? (
        <StateFeedback
          compact
          description="The network switch was not approved. You can try again."
          surface={surface}
          title="Network switch was not approved"
          tone="error"
        />
      ) : null}
      <AdminSignOut session={adminSession} />
    </WalletStateFrame>
  );
}

function ConnectedWalletControl({
  adminSession,
  address,
  disconnectStatus,
  onDisconnect,
  surface,
}: {
  readonly adminSession: AdminSession;
  readonly address: string;
  readonly disconnectStatus: WalletSession["disconnectStatus"];
  readonly onDisconnect: () => void;
  readonly surface: FeedbackSurface;
}) {
  const disconnecting = disconnectStatus === "pending";
  const failed = disconnectStatus === "error";
  const label = disconnecting
    ? applicationCopy.shell.disconnectingWallet
    : failed
      ? applicationCopy.shell.retryDisconnectWallet
      : applicationCopy.shell.disconnectWallet;
  return (
    <WalletStateFrame state="connected">
      <Popover>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" />}
          aria-label={`Wallet ${compactAddress(address)}`}
        >
          <span
            aria-label={applicationCopy.shell.connectedWallet}
            className="font-mono text-caption"
          >
            {compactAddress(address)}
          </span>
          <ChevronDown aria-hidden="true" className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Wallet account">
          <p className="text-title-sm font-semibold">Your wallet</p>
          <p className="mt-2 break-all font-mono text-body-sm">{address}</p>
          <p className="mt-2 text-body-sm text-ink-soft">
            {deploymentEnvironment.chainLabel} · Test assets have no value
          </p>
          <div className="mt-4 grid gap-1 border-t border-line pt-3">
            <Link
              href="/fleet"
              className="flex min-h-11 items-center text-body"
            >
              View balances and Fleet
            </Link>
            <Link
              href="/faucet"
              className="flex min-h-11 items-center text-body"
            >
              Get test funds
            </Link>
            <Button
              aria-busy={disconnecting || undefined}
              aria-label={label}
              className="justify-start px-0"
              disabled={disconnecting}
              onClick={onDisconnect}
              size="sm"
              type="button"
              variant="ghost"
            >
              <LogOut aria-hidden="true" className="size-4" />
              {label}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {disconnecting || failed ? (
        <StateFeedback
          compact
          description={
            disconnecting
              ? applicationCopy.shell.disconnectPending
              : applicationCopy.shell.disconnectFailedDescription
          }
          surface={surface}
          title={
            disconnecting
              ? applicationCopy.shell.disconnectingWallet
              : applicationCopy.shell.disconnectFailedTitle
          }
          tone={disconnecting ? "loading" : "error"}
        />
      ) : null}
      <AdminSignOut session={adminSession} />
    </WalletStateFrame>
  );
}

/**
 * `notices` suppresses the connection and network explanations when another
 * control on the page already shows them, so one state never gets two voices.
 * The action itself always renders.
 */
export function WalletControl({
  notices = true,
  surface = "default",
}: {
  readonly notices?: boolean;
  readonly surface?: FeedbackSurface;
} = {}) {
  const controlId = useId();
  const connectionReasonId = `wallet-connection-reason-${controlId}`;
  const networkReasonId = `wallet-network-reason-${controlId}`;
  const adminSession = useOptionalAdminSession();
  const connection = useConnection();
  const session = useWalletSession();
  const switchChain = useSwitchChain();
  const status =
    connection.status === "disconnected" &&
    (!session.ready || session.connecting)
      ? "connecting"
      : connection.status;

  const disconnectWallet = async () => {
    await adminSession?.endSession();
    session.disconnect();
  };

  if (connection.status !== "connected") {
    return (
      <ConnectionWalletControl
        adminSession={adminSession}
        configured={isWalletConfigured}
        notices={notices}
        onConnect={session.connect}
        reasonId={connectionReasonId}
        rejected={session.rejected}
        status={status}
        surface={surface}
      />
    );
  }

  if (connection.chainId !== protocolChain.id) {
    return (
      <WrongNetworkWalletControl
        adminSession={adminSession}
        notices={notices}
        onSwitch={() => switchChain.mutate({ chainId: protocolChain.id })}
        reasonId={networkReasonId}
        rejected={switchChain.isError}
        switching={switchChain.isPending}
        surface={surface}
      />
    );
  }

  return (
    <ConnectedWalletControl
      adminSession={adminSession}
      address={connection.address}
      disconnectStatus={session.disconnectStatus}
      onDisconnect={() => void disconnectWallet()}
      surface={surface}
    />
  );
}
