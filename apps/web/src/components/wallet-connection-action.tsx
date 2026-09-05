"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import { buttonVariants } from "@/components/ui/button";
import {
  dialogActionsClassName,
  dialogBackdropClassName,
  dialogDescriptionClassName,
  dialogPopupClassName,
  dialogTitleClassName,
} from "@/components/ui/dialog";
import { identity } from "@/lib/identity";
import { cn } from "@/lib/utils";

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
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        aria-describedby={ariaDescribedBy}
        className={cn(buttonVariants({ size }), className)}
        disabled={disabled}
      >
        {children}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={dialogBackdropClassName} />
        <AlertDialog.Popup className={dialogPopupClassName}>
          <AlertDialog.Title className={dialogTitleClassName}>
            Connect only what you need
          </AlertDialog.Title>
          <AlertDialog.Description className={dialogDescriptionClassName}>
            Connect a wallet to view your collection and approve Base Sepolia
            actions. {identity.brand} never takes custody of your assets and
            will not ask for an email login. Connecting alone does not submit a
            transaction.
          </AlertDialog.Description>
          <ul className="mt-4 grid gap-1.5 border-t border-line pt-4 font-mono text-body-sm text-ink-soft">
            <li>· Check the wallet and network shown before approving.</li>
            <li>
              · Every asset in this application is a valueless test asset.
            </li>
            <li>· You can disconnect from the application at any time.</li>
          </ul>
          <div className={dialogActionsClassName}>
            <AlertDialog.Close
              className={buttonVariants({ variant: "outline" })}
            >
              Not now
            </AlertDialog.Close>
            <AlertDialog.Close
              className={buttonVariants()}
              onClick={onContinue}
            >
              Choose wallet
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
