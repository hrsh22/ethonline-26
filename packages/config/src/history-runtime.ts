import { Buffer } from "node:buffer";

const HISTORY_CREDENTIAL = /^[A-Za-z0-9_-]{43,512}$/u;

export type HistoryCredentialName =
  "HISTORY_READ_API_TOKEN" | "HISTORY_INGEST_API_TOKEN";

const invalidHistoryCredential = (name: HistoryCredentialName): Error =>
  new Error(
    `${name} must be 43 to 512 unpadded base64url characters in canonical form encoding at least 32 bytes`,
  );

export const parseHistoryCredential = (
  value: string | undefined,
  name: HistoryCredentialName,
): string => {
  if (value === undefined || !HISTORY_CREDENTIAL.test(value)) {
    throw invalidHistoryCredential(name);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength < 32 || decoded.toString("base64url") !== value) {
    throw invalidHistoryCredential(name);
  }
  if (decoded.every((byte) => byte === decoded[0])) {
    throw new Error(`${name} must contain nontrivial random material`);
  }
  return value;
};

export const parseHistoryLoopbackUrl = (value: string): string => {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]+)$/u.exec(value);
  const port = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || port === 80) {
    throw new Error(
      "HISTORY_INDEX_URL must be the exact root http://127.0.0.1:<port> with an explicit nondefault port",
    );
  }
  return value;
};
