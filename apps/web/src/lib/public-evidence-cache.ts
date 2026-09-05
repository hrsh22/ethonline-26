import {
  decodePublicStatusCache,
  encodePublicStatusCache,
  type PublicStatusModel,
} from "@orbit/protocol/public-status-codec";

interface PublicEvidenceStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

const cacheKey = (scope: string) => `orbit:public-evidence:v1:${scope}`;

export const writePublicEvidenceCache = (
  storage: PublicEvidenceStorage,
  scope: string,
  model: PublicStatusModel,
  savedAt = Date.now(),
): void => {
  try {
    storage.setItem(
      cacheKey(scope),
      encodePublicStatusCache({ model, savedAt }),
    );
  } catch {
    // Public evidence still renders from the live read when storage is full or
    // disabled; persistence is an acceleration, not a correctness boundary.
  }
};

export const readPublicEvidenceCache = (
  storage: Pick<PublicEvidenceStorage, "getItem">,
  scope: string,
) => {
  try {
    const raw = storage.getItem(cacheKey(scope));
    if (raw === null) return undefined;
    return decodePublicStatusCache(raw);
  } catch {
    return undefined;
  }
};
