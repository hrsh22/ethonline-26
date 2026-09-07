import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { Route } from "next";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Every action in the application is one of these.
 *
 * The filled variant is the only place signal orange appears as a fill, so a
 * page has exactly one obvious next action. Everything else is a grey outline
 * or a quiet ghost. Labels are set in the mono caps the rest of the system
 * uses for controls, which is why they read as instrument keys rather than as
 * web buttons.
 */
const buttonVariants = cva(
  "group/button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-transparent bg-clip-padding px-4 font-mono text-body-sm font-semibold tracking-[0.06em] uppercase transition-[background-color,border-color,color,transform,filter] duration-[var(--motion-fast)] ease-[var(--ease-standard)] outline-none select-none focus-visible:ring-3 focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none data-disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 motion-reduce:transition-none motion-reduce:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:brightness-110 disabled:border-[var(--border-subtle)] data-disabled:border-[var(--border-subtle)] disabled:bg-[var(--surface-3)] data-disabled:bg-[var(--surface-3)] disabled:text-[var(--text-tertiary)] data-disabled:text-[var(--text-tertiary)]",
        outline:
          "border-[var(--border-strong)] bg-transparent text-ink hover:bg-surface-3 aria-expanded:bg-surface-3 disabled:text-ink-faint data-disabled:text-ink-faint",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_8%)] aria-expanded:bg-secondary disabled:text-ink-faint data-disabled:text-ink-faint",
        ghost:
          "text-ink-soft hover:bg-surface-3 hover:text-ink aria-expanded:bg-surface-3 aria-expanded:text-ink disabled:text-ink-faint data-disabled:text-ink-faint",
        destructive:
          "border-[var(--status-danger-text)] text-destructive hover:bg-danger-surface focus-visible:border-destructive",
        link: "min-w-0 px-0 normal-case tracking-normal text-[var(--accent-text)] underline-offset-4 hover:underline",
      },
      size: {
        default: "px-4 py-2",
        xs: "gap-1 px-2 py-1 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "gap-1.5 px-3 py-2 text-label",
        lg: "min-h-12 px-5 py-3 text-body",
        icon: "size-11 px-0",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    // Text actions must grow with enlarged or wrapped labels. Icon controls
    // retain their fixed dimensions and the shared minimum touch target.
    compoundVariants: [
      {
        size: ["default", "xs", "sm", "lg"],
        className: "h-auto max-w-full whitespace-normal",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/**
 * A link that is an action.
 *
 * Generic over the route, which is how Next documents a component wrapping
 * `Link`, and narrow in its other props on purpose.
 * `ComponentPropsWithoutRef<typeof Link>` collapses Link's own route generic to
 * `unknown`, so the wrapper accepted no dynamic route at all. Carrying the full
 * anchor-prop type alongside `href` breaks it a second way: TS then resolves
 * the JSX call to `LinkProps<URL>`, and `/fleet/${id}` is not assignable to
 * `RouteImpl<URL>`. Listing only the props the call sites pass keeps typed
 * routes working; widen this deliberately if a caller needs more.
 * See node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md
 */
function ButtonLink<T extends string>({
  className,
  href,
  variant = "default",
  size = "default",
  ...props
}: VariantProps<typeof buttonVariants> & {
  readonly "aria-describedby"?: string | undefined;
  readonly "aria-label"?: string | undefined;
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
  readonly href: Route<T>;
}) {
  return (
    <Link
      className={cn(buttonVariants({ variant, size, className }))}
      data-slot="button-link"
      href={href}
      {...props}
    />
  );
}

export { Button, ButtonLink, buttonVariants };
