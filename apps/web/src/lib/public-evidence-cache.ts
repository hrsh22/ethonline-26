interface PublicEvidenceStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

interface CachedPublicEvidence<Model> {
  readonly model: Model;
  readonly savedAt: number;
}

const cacheKey = (scope: string) => `orbit:public-evidence:v1:${scope}`;
const bigintMarker = "__orbitPublicBigInt";

const encode = (_key: string, value: unknown) =>
  typeof value === "bigint" ? { [bigintMarker]: value.toString() } : value;

const decode = (_key: string, value: unknown) => {
  if (
    typeof value === "object" &&
    value !== null &&
    bigintMarker in value &&
    typeof (value as Record<string, unknown>)[bigintMarker] === "string"
  ) {
    return BigInt((value as Record<string, string>)[bigintMarker] ?? "0");
  }
  return value;
};

export const writePublicEvidenceCache = <Model>(
  storage: PublicEvidenceStorage,
  scope: string,
  model: Model,
  savedAt = Date.now(),
): void => {
  try {
    storage.setItem(
      cacheKey(scope),
      JSON.stringify({ model, savedAt }, encode),
    );
  } catch {
    // Public evidence still renders from the live read when storage is full or
    // disabled; persistence is an acceleration, not a correctness boundary.
  }
};

export const readPublicEvidenceCache = <Model = unknown>(
  storage: Pick<PublicEvidenceStorage, "getItem">,
  scope: string,
): CachedPublicEvidence<Model> | undefined => {
  try {
    const raw = storage.getItem(cacheKey(scope));
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw, decode) as Record<string, unknown>;
    if (
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      parsed.savedAt < 0 ||
      parsed.model === undefined
    ) {
      return undefined;
    }
    return {
      model: parsed.model as Model,
      savedAt: parsed.savedAt,
    };
  } catch {
    return undefined;
  }
};
