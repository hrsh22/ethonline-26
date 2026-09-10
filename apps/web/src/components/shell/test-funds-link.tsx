import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function TestFundsLink({
  active = false,
  children = "Get test funds",
  className,
  href = "/faucet",
  variant = "text",
}: {
  readonly active?: boolean;
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly href?: Route;
  readonly variant?: "chrome" | "text";
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 w-fit items-center whitespace-nowrap font-mono text-body-sm transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none",
        variant === "chrome"
          ? "rounded-sm border border-line px-3 text-ink-soft hover:border-ink-faint hover:text-ink"
          : "text-signal underline decoration-1 underline-offset-4 hover:text-ink",
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}
