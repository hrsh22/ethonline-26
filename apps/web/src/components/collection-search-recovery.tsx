"use client";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";

export function CollectionSearchRecovery() {
  const pathname = usePathname();
  const attempted = pathname?.match(/^\/fleet\/([^/]+)$/u)?.[1];
  let value = "";
  try {
    value = decodeURIComponent(attempted ?? "").slice(0, 40);
  } catch {
    /* Keep recovery usable for malformed URLs. */
  }
  return (
    <ButtonLink
      href={value ? `/explore?q=${encodeURIComponent(value)}` : "/explore"}
    >
      Search the collection
    </ButtonLink>
  );
}
