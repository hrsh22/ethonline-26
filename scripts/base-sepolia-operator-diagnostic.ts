/**
 * Convert provider-controlled failures into bounded, safe operator diagnostics.
 *
 * This module intentionally has a very small interface. Values crossing the
 * provider seam are untrusted: getters may throw, proxies may be revoked, and
 * coercion may have side effects. We only inspect three allowlisted fields and
 * never coerce an object to text.
 */

export const MAXIMUM_OPERATOR_DIAGNOSTIC_LENGTH = 512;

const MAXIMUM_DIAGNOSTIC_INPUT_LENGTH = 4_096;
const MAXIMUM_CAUSE_DEPTH = 4;
const DEFAULT_OPERATOR_DIAGNOSTIC = "Operator run failed";

const sensitiveUrl = /\b(?:https?|wss?):\/\/[^\s)\]}>,]+/giu;
const sensitiveAssignment =
  /(\b(?:authorization|api[_-]?key|access[_-]?token|token|secret|password)\b\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const bearerCredential = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const jwtCredential =
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/gu;
const longHexPayload = /\b0x[0-9a-f]{32,}\b/giu;
// eslint-disable-next-line no-control-regex -- control characters are deliberately removed from logs
const controlCharacters = /[\u0000-\u001f\u007f]+/gu;
const repeatedWhitespace = /\s{2,}/gu;

interface PropertyRead {
  readonly succeeded: boolean;
  readonly value?: unknown;
}

const isInspectable = (
  value: unknown,
): value is object | ((...arguments_: never[]) => unknown) =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const readPropertyOnce = (value: object, key: PropertyKey): PropertyRead => {
  try {
    return { succeeded: true, value: Reflect.get(value, key) };
  } catch {
    return { succeeded: false };
  }
};

const sanitizeDiagnosticText = (value: string): string =>
  value
    .slice(0, MAXIMUM_DIAGNOSTIC_INPUT_LENGTH)
    .replace(sensitiveUrl, "[REDACTED_URL]")
    .replace(sensitiveAssignment, "$1[REDACTED]")
    .replace(bearerCredential, "Bearer [REDACTED]")
    .replace(jwtCredential, "[REDACTED_JWT]")
    .replace(longHexPayload, "[REDACTED_HEX]")
    .replace(controlCharacters, " ")
    .replace(repeatedWhitespace, " ")
    .trim();

const boundedDiagnostic = (
  parts: readonly string[],
  fallback: string,
): string => {
  const diagnostic = parts
    .join(": ")
    .slice(0, MAXIMUM_OPERATOR_DIAGNOSTIC_LENGTH);
  return diagnostic.length === 0 ? fallback : diagnostic;
};

const safeFallback = (fallback: unknown): string => {
  if (typeof fallback !== "string") return DEFAULT_OPERATOR_DIAGNOSTIC;
  const sanitized = sanitizeDiagnosticText(fallback).slice(
    0,
    MAXIMUM_OPERATOR_DIAGNOSTIC_LENGTH,
  );
  return sanitized.length === 0 ? DEFAULT_OPERATOR_DIAGNOSTIC : sanitized;
};

interface DiagnosticReads {
  readonly candidate: string | undefined;
  readonly nestedCause: PropertyRead;
}

const readDiagnosticFields = (current: object): DiagnosticReads => {
  const shortMessage = readPropertyOnce(current, "shortMessage");
  const message = readPropertyOnce(current, "message");
  const nestedCause = readPropertyOnce(current, "cause");
  const candidate =
    shortMessage.succeeded && typeof shortMessage.value === "string"
      ? shortMessage.value
      : message.succeeded && typeof message.value === "string"
        ? message.value
        : undefined;
  return { candidate, nestedCause };
};

const appendPart = (parts: string[], candidate: string | undefined): void => {
  if (candidate === undefined) return;
  const sanitized = sanitizeDiagnosticText(candidate);
  if (sanitized.length > 0 && !parts.includes(sanitized)) {
    parts.push(sanitized);
  }
};

const collectDiagnosticParts = (cause: object): string[] => {
  const visited = new WeakSet<object>();
  const parts: string[] = [];
  let current: unknown = cause;
  let depth = 0;
  while (depth < MAXIMUM_CAUSE_DEPTH) {
    if (typeof current === "string") {
      appendPart(parts, current);
      break;
    }
    if (!isInspectable(current) || visited.has(current)) break;
    visited.add(current);
    const reads = readDiagnosticFields(current);
    appendPart(parts, reads.candidate);
    if (!reads.nestedCause.succeeded) break;
    current = reads.nestedCause.value;
    depth += 1;
  }
  return parts;
};

/**
 * Safely normalize a provider failure for logs and operator UI.
 *
 * The function is total for arbitrary JavaScript values, including throwing
 * and revoked proxies. It reads shortMessage, message, and cause once per
 * traversed object, follows at most four causes, and bounds both input and
 * output text.
 */
export const operatorDiagnostic = (
  cause: unknown,
  fallback = DEFAULT_OPERATOR_DIAGNOSTIC,
): string => {
  try {
    const resolvedFallback = safeFallback(fallback);

    if (typeof cause === "string") {
      return boundedDiagnostic(
        [sanitizeDiagnosticText(cause)],
        resolvedFallback,
      );
    }
    if (!isInspectable(cause)) return resolvedFallback;
    return boundedDiagnostic(collectDiagnosticParts(cause), resolvedFallback);
  } catch {
    return DEFAULT_OPERATOR_DIAGNOSTIC;
  }
};

/** Alias used by watch-cycle callers. */
