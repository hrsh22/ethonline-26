"use client";

import Link from "next/link";
import type { CompletedCollectorTransaction } from "@/lib/collector-transaction-record";

export function CompletedActivity({
  records,
}: {
  readonly records: readonly CompletedCollectorTransaction[];
}) {
  if (records.length === 0) return null;
  return (
    <details className="mt-3 text-body">
      <summary className="min-h-11 cursor-pointer content-center">
        Recent completed activity ({records.length})
      </summary>
      <p className="text-body-sm text-ink-soft">
        Up to 20 confirmed actions saved on this device. These are past
        transactions; current ownership and rewards are shown on the collectible
        page.
      </p>
      <ol className="mt-2 grid gap-3">
        {[...records].reverse().map((record) => (
          <li
            key={record.operationId}
            className="grid gap-1 border-t border-line pt-3"
          >
            <strong>{record.state.label} · confirmed</strong>
            <span className="text-body-sm text-ink-soft">
              Base Sepolia · {new Date(record.savedAt).toLocaleString()}
            </span>
            <div className="flex flex-wrap gap-x-4">
              <a
                className="inline-flex min-h-11 items-center text-signal underline"
                href={`https://sepolia.basescan.org/tx/${record.state.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
              {record.affectedIdentityIds.length === 1 ? (
                <Link
                  className="inline-flex min-h-11 items-center text-signal underline"
                  href={`/fleet/${record.affectedIdentityIds[0]}`}
                >
                  View identity #{record.affectedIdentityIds[0]}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
