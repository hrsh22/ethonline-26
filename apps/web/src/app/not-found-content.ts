import type { Metadata } from "next";

import { applicationCopy, identity } from "@/lib/identity";

export const notFoundContent = {
  eyebrow: "404",
  introduction:
    "The requested page does not exist or is outside the available collection.",
  link: applicationCopy.common.returnHome,
  learn: applicationCopy.common.openLearn,
  metadata: {
    title: "Page not found",
    description: `The requested ${identity.brand} page does not exist.`,
  } satisfies Metadata,
  title: "Page not found",
} as const;
