"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  align = "center",
  className,
  side = "bottom",
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Popup> & {
  readonly align?: ComponentProps<typeof PopoverPrimitive.Positioner>["align"];
  readonly side?: ComponentProps<typeof PopoverPrimitive.Positioner>["side"];
  readonly sideOffset?: ComponentProps<
    typeof PopoverPrimitive.Positioner
  >["sideOffset"];
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        className="z-50 outline-none"
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(32rem,calc(100dvh-6rem))] overflow-y-auto rounded-[var(--radius-surface)] border border-line-strong bg-surface-1 p-4 text-ink shadow-[var(--shadow-overlay)] outline-none transition-[opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent, PopoverTrigger };
