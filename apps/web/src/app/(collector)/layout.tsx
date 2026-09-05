import { CollectorShell } from "@/components/shell/collector-shell";

export default function CollectorLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <CollectorShell>{children}</CollectorShell>;
}
