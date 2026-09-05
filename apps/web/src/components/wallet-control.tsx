"use client";

import { modal } from "@reown/appkit/react";
import { LogOut } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useConnection, useDisconnect, useSwitchChain } from "wagmi";

import { DisabledReason, StateFeedback } from "@/components/state-feedback";
import { Button } from "@/components/ui/button";
import { WalletConnectionAction } from "@/components/wallet-connection-action";
import { useReownConnectionFeedback } from "@/components/use-reown-connection-feedback";
import { useOptionalAdminSession } from "@/components/admin/admin-session-boundary";
import { deploymentEnvironment } from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import { isReownConfigured, protocolChain } from "@/lib/wagmi";

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
          description="The wallet connection was not approved. Try again when ready."
          surface={surface}
          title="Connection request declined"
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
  onDisconnect,
}: {
  readonly adminSession: AdminSession;
  readonly address: string;
  readonly onDisconnect: () => void;
}) {
  return (
    <WalletStateFrame state="connected">
      {/* Below the rail breakpoint this pair shares one 56px bar with the
          brand and the menu toggle, and the spelled-out button pushed it onto
          a second line: the address floated above the wordmark and the header
          grew to 96px on every route a wallet was connected on. The chip
          drops its indicator and tightens, and the action becomes its icon. */}
      <span
        aria-label={applicationCopy.shell.connectedWallet}
        className="wallet-address flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-2 font-mono text-caption tracking-[0.02em] text-ink tabular-nums compact:px-3 compact:text-body-sm compact:tracking-[0.04em]"
      >
        <span
          aria-hidden="true"
          className="hidden size-1.5 flex-none rounded-full bg-[var(--status-success-fill)] laptop:inline-block"
        />
        {compactAddress(address)}
      </span>
      <Button
        aria-label={applicationCopy.shell.disconnectWallet}
        className="px-3 laptop:px-4"
        onClick={onDisconnect}
        size="sm"
        type="button"
        variant="ghost"
      >
        <LogOut aria-hidden="true" className="size-4 laptop:hidden" />
        <span className="hidden laptop:inline">
          {applicationCopy.shell.disconnectWallet}
        </span>
      </Button>
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
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const connectionFeedback = useReownConnectionFeedback();

  const disconnectWallet = async () => {
    await adminSession?.endSession();
    disconnect.mutate();
  };

  if (connection.status !== "connected") {
    return (
      <ConnectionWalletControl
        adminSession={adminSession}
        configured={isReownConfigured}
        notices={notices}
        onConnect={() => {
          connectionFeedback.beginConnection();
          void Promise.resolve(modal?.open({ view: "Connect" })).catch(() =>
            connectionFeedback.failConnection(),
          );
        }}
        reasonId={connectionReasonId}
        rejected={connectionFeedback.rejected}
        status={connection.status}
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
      onDisconnect={() => void disconnectWallet()}
    />
  );
}
