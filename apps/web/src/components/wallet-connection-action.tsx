"use client";

import { useEffect, useRef } from "react";

import { CircleHelp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { identity } from "@/lib/identity";
import { useWalletSession } from "@/providers/wallet-session";

// The header and in-page controls share one Privy chooser.
let latestConnectionTrigger: HTMLButtonElement | null = null;

export function WalletConnectionAction({
  ariaDescribedBy,
  children,
  className,
  disabled = false,
  onContinue,
  size = "default",
}: {
  readonly ariaDescribedBy?: string | undefined;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onContinue: () => void;
  readonly size?: "default" | "sm";
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const { modalOpen } = useWalletSession();
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !modalOpen;
    wasOpen.current = modalOpen;
    if (!closed || latestConnectionTrigger !== trigger.current) return;
    const frame = requestAnimationFrame(() => {
      const button = trigger.current;
      if (latestConnectionTrigger !== button) return;
      latestConnectionTrigger = null;
      if (button?.isConnected && document.activeElement === document.body) {
        button.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [modalOpen]);
  useEffect(() => {
    const button = trigger.current;
    return () => {
      if (latestConnectionTrigger === button) latestConnectionTrigger = null;
    };
  }, []);
  return (
    <div className="relative flex min-w-0 max-w-full flex-wrap items-center gap-1">
      <Button
        aria-describedby={ariaDescribedBy}
        aria-haspopup="dialog"
        className={className}
        disabled={disabled}
        focusableWhenDisabled
        ref={trigger}
        onClick={() => {
          latestConnectionTrigger = trigger.current;
          onContinue();
        }}
        size={size}
      >
        {children}
      </Button>
      <details className="text-body-sm text-ink-soft">
        <summary
          aria-label="What does connecting allow?"
          className="flex size-11 cursor-pointer list-none items-center justify-center rounded border border-line-strong text-ink-soft [&::-webkit-details-marker]:hidden"
        >
          <CircleHelp aria-hidden="true" className="size-5" />
        </summary>
        <p className="absolute top-full left-0 z-50 mt-2 w-[min(20rem,calc(100vw-4rem))] [header.sticky_&]:right-0 [header.sticky_&]:left-auto [header.sticky_&]:w-[min(20rem,calc(100vw-6rem))] rounded border border-line bg-surface-1 p-4 text-body shadow-[var(--shadow-overlay)] laptop:[header.sticky_&]:right-auto laptop:[header.sticky_&]:left-0 laptop:[header.sticky_&]:top-auto laptop:[header.sticky_&]:bottom-full laptop:[header.sticky_&]:mt-0 laptop:[header.sticky_&]:mb-2">
          {identity.brand} reads your public collection. Connecting does not
          submit a transaction or give permission to spend. You approve each
          action in your wallet. This app uses valueless Base Sepolia test
          assets.
        </p>
      </details>
    </div>
  );
}
