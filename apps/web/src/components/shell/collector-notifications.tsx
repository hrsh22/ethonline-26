"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

import { CompletedActivity } from "@/components/shell/completed-activity";
import { WalletTransactionActivity } from "@/components/shell/collector-activity";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type Protocol = ReturnType<typeof useProtocolClient>;
const subscribeToDocument = () => () => {};
const browserPortal = () => document.body;
const serverPortal = () => null;
const confirmedHash = (transaction: Protocol["transaction"]) =>
  transaction.status === "confirmed" ? transaction.hash : undefined;
const unreadCount = (
  open: boolean,
  savedCount: number,
  currentHash: string | undefined,
  readTransactionHash: string | undefined,
) =>
  open
    ? 0
    : savedCount +
      Number(currentHash !== undefined && currentHash !== readTransactionHash);

/** Completed records stay available without becoming a banner on every route. */
function NotificationsMenu({ protocol }: { readonly protocol: Protocol }) {
  const records = protocol.completedTransactions ?? [];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [visibleRecords, setVisibleRecords] = useState(records);
  const [readTransactionHash, setReadTransactionHash] = useState<string>();
  const confirmed = protocol.transaction.status === "confirmed";
  const currentHash = confirmedHash(protocol.transaction);
  const savedRecords = records.filter(
    (record) => record.state.hash !== currentHash,
  );
  const count = unreadCount(
    open,
    savedRecords.length,
    currentHash,
    readTransactionHash,
  );
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setVisibleRecords(savedRecords);
      setReadTransactionHash(currentHash);
      protocol.markCompletedTransactionsRead?.();
    } else if (confirmed) {
      // A confirmation can arrive after opening and is shown in the panel.
      setReadTransactionHash(currentHash);
      protocol.markCompletedTransactionsRead?.();
      protocol.clearTransaction?.();
    }
    setOpen(nextOpen);
  };
  const handleOpenChangeComplete = (nextOpen: boolean) => {
    if (!nextOpen) triggerRef.current?.focus();
  };
  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
        <PopoverTrigger
          render={
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              className="relative"
            />
          }
          aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
        >
          <Bell aria-hidden="true" className="size-5" />
          {count > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-0 right-0 min-w-4 rounded-full bg-signal-fill px-1 text-[12px] leading-4 text-primary-foreground"
            >
              {count}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="collector-notifications"
          aria-label="Notifications"
        >
          <h2 className="text-title font-semibold">Notifications</h2>
          <p className="mt-1 text-body-sm text-ink-soft">
            Completed wallet activity. Notifications clear after you close this
            panel.
          </p>
          {confirmed ? <WalletTransactionActivity protocol={protocol} /> : null}
          <CompletedActivity records={visibleRecords} />
          {!confirmed && visibleRecords.length === 0 ? (
            <p className="py-6 text-body text-ink-soft">
              No new notifications.
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
      <CompletionToast
        protocol={protocol}
        open={open}
        onOpen={() => handleOpenChange(true)}
      />
    </>
  );
}

function CompletionToast({
  protocol,
  open,
  onOpen,
}: {
  readonly protocol: Protocol;
  readonly open: boolean;
  readonly onOpen: () => void;
}) {
  const portal = useSyncExternalStore(
    subscribeToDocument,
    browserPortal,
    serverPortal,
  );
  return protocol.transaction.status === "confirmed" && !open && portal !== null
    ? createPortal(
        <aside
          className="collector-completion-toast"
          aria-label="Transaction complete"
        >
          <div role="status">
            <p className="font-semibold">Confirmed on Base Sepolia</p>
            <p className="text-body-sm text-ink-soft">
              {protocol.transaction.label}
            </p>
            {protocol.transaction.message === undefined ? null : (
              <p className="mt-1 text-body-sm text-ink-soft">
                {protocol.transaction.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onOpen}>
              View notification
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={protocol.clearTransaction}
              aria-label="Dismiss completed activity"
            >
              Dismiss
            </Button>
          </div>
        </aside>,
        portal,
      )
    : null;
}

export function CollectorNotifications() {
  const protocol = useProtocolClient();
  const pathname = usePathname();
  return (
    <NotificationsMenu
      key={`${protocol.address}:${protocol.chainId}:${pathname}`}
      protocol={protocol}
    />
  );
}
