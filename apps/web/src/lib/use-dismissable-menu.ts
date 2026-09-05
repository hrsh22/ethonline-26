"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const documentOrder = (left: HTMLElement, right: HTMLElement): number =>
  left === right
    ? 0
    : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1;

/**
 * Everything the trap cycles through, in document order. The order used to be
 * fabricated as [control, ...menu contents], which silently excluded any
 * focusable element sitting between them in the DOM: on the collector shell
 * the wallet controls live between the navigation and its toggle, so with the
 * menu open a keyboard user had no path to connecting or disconnecting a
 * wallet -- Tab wrapped straight past them in both directions.
 */
const focusableWithin = (
  menu: HTMLElement,
  control: HTMLElement | null,
  peers: readonly (HTMLElement | null)[],
): readonly HTMLElement[] => {
  const members = new Set<HTMLElement>(
    menu.querySelectorAll<HTMLElement>(FOCUSABLE),
  );
  if (control !== null) members.add(control);
  for (const peer of peers) {
    if (peer === null) continue;
    if (peer.matches(FOCUSABLE)) members.add(peer);
    for (const inner of peer.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      members.add(inner);
    }
  }
  return [...members].sort(documentOrder);
};

const wrapTabTarget = (
  order: readonly HTMLElement[],
  active: Element | null,
  backwards: boolean,
): HTMLElement | undefined => {
  if (order.length === 0) return undefined;
  const first = order[0];
  const last = order[order.length - 1];
  if (backwards && active === first) return last;
  if (!backwards && active === last) return first;
  return undefined;
};

export interface DismissableMenuOptions {
  /** The control that toggles the menu. Focus returns here on Escape. */
  readonly control: RefObject<HTMLElement | null>;
  readonly menu: RefObject<HTMLElement | null>;
  /**
   * Called when the menu should close. `returnFocus` is true only for
   * keyboard dismissal, where moving focus is expected.
   */
  readonly onDismiss: (returnFocus: boolean) => void;
  readonly open: boolean;
  /**
   * Focusable regions outside the menu that stay reachable while it is open,
   * such as the wallet controls that share the header with the toggle.
   */
  readonly peers?: readonly RefObject<HTMLElement | null>[];
}

/**
 * Gives a disclosure menu the dismissal behaviour a keyboard or pointer user
 * expects: Escape closes and returns focus, an interaction outside closes
 * without stealing focus, and Tab stays inside the open menu.
 */
export const useDismissableMenu = ({
  control,
  menu,
  onDismiss,
  open,
  peers,
}: DismissableMenuOptions): void => {
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissRef.current(true);
        return;
      }
      if (event.key !== "Tab" || menu.current === null) return;
      const order = focusableWithin(
        menu.current,
        control.current,
        (peers ?? []).map((peer) => peer.current),
      );
      const target = wrapTabTarget(
        order,
        document.activeElement,
        event.shiftKey,
      );
      if (target === undefined) return;
      event.preventDefault();
      target.focus();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (menu.current?.contains(target) === true) return;
      if (control.current?.contains(target) === true) return;
      // A peer is part of the open-menu experience; interacting with it must
      // not yank the menu shut mid-action.
      if (
        (peers ?? []).some((peer) => peer.current?.contains(target) === true)
      ) {
        return;
      }
      dismissRef.current(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [control, menu, open, peers]);
};
