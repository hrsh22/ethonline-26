/**
 * Chrome for the alert dialogs: the scrim and the popup.
 *
 * Both the wallet-connection explainer and the irreversible Launch confirmation
 * use Base UI's `AlertDialog`; these class strings keep them on one shape.
 */
export const dialogBackdropClassName =
  "fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-[var(--motion-standard)] ease-[var(--ease-standard)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none";

export const dialogPopupClassName =
  "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-surface)] border border-line-strong bg-surface-1 p-5 text-ink shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] data-ending-style:opacity-0 data-starting-style:-translate-y-[calc(50%+6px)] data-starting-style:opacity-0 motion-reduce:transition-none";

export const dialogTitleClassName =
  "font-mono text-title-sm font-semibold tracking-[0.04em] text-ink uppercase";

export const dialogDescriptionClassName = "mt-2 text-body-sm text-ink-soft";

export const dialogActionsClassName =
  "mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4";
