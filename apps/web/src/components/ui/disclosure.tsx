"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Secondary detail, kept out of the way but properly contained: a real 44px
 * target, a hairline that ties it to its content, and an indicator that says
 * which way it opens.
 */
export function Disclosure({
  children,
  className,
  defaultOpen = false,
  searchable = false,
  title,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  /**
   * Keeps the collapsed content in the document, hidden with
   * `hidden="until-found"` so the browser's own page search can find and open
   * it. Use it whenever the content is evidence rather than elaboration.
   */
  readonly searchable?: boolean;
  readonly title: string;
}) {
  return (
    <Collapsible.Root
      className={cn("border-t border-line", className)}
      defaultOpen={defaultOpen}
    >
      <Collapsible.Trigger className="group flex min-h-11 w-full items-center gap-2 py-2 text-left font-mono text-body-sm font-medium text-ink-soft transition-colors duration-[var(--motion-fast)] hover:text-ink motion-reduce:transition-none">
        <ChevronRight
          aria-hidden="true"
          className="size-4 flex-none text-ink-faint transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Panel
        hiddenUntilFound={searchable}
        className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-[var(--motion-standard)] ease-[var(--ease-standard)] data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none [&[hidden]:not([hidden='until-found'])]:hidden"
      >
        <div className="pt-1 pb-4 pl-6">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
