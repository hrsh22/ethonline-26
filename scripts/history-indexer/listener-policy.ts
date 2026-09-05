import { parseHistoryCredential } from "@orbit/config/history-runtime";

export const HISTORY_LOOPBACK_HOST = "127.0.0.1" as const;

export interface HistoryListenerPolicy {
  readonly host: typeof HISTORY_LOOPBACK_HOST;
  readonly readApiToken: string;
  readonly ingestApiToken: string;
}

export const resolveHistoryListenerPolicy = (input: {
  readonly host: string;
  readonly readApiToken: string | undefined;
  readonly ingestApiToken: string | undefined;
}): HistoryListenerPolicy => {
  if (input.host !== HISTORY_LOOPBACK_HOST) {
    throw new Error("HISTORY_HOST must be exactly 127.0.0.1");
  }
  const readApiToken = parseHistoryCredential(
    input.readApiToken,
    "HISTORY_READ_API_TOKEN",
  );
  const ingestApiToken = parseHistoryCredential(
    input.ingestApiToken,
    "HISTORY_INGEST_API_TOKEN",
  );
  if (readApiToken === ingestApiToken) {
    throw new Error("History read and ingestion credentials must be distinct");
  }
  return { host: HISTORY_LOOPBACK_HOST, readApiToken, ingestApiToken };
};
