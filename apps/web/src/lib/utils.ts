import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The type scale is custom (`text-body`, `text-label`, …), so tailwind-merge
 * has to be told these are font sizes. Left as defaults it reads them as text
 * colours and drops a real colour class that precedes them — which is how a
 * filled button lost its label.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "label",
            "caption",
            "body-sm",
            "body",
            "lede",
            "title-sm",
            "title",
            "heading",
            "display",
            "hero",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
