import { COLLECTION_SIZE } from "@orbit/config/collection-manifest";

export const parseCanonicalIdentityId = (value: string) => {
  if (!/^[1-9]\d{0,3}$/u.test(value)) return undefined;
  const identityId = Number(value);
  return identityId <= COLLECTION_SIZE ? identityId : undefined;
};

/** Accept familiar display forms at the search boundary; URLs remain canonical. */
export const parseIdentitySearch = (value: string) => {
  const normalized = value.trim().replace(/^#\s*/u, "");
  if (!/^\d+$/u.test(normalized)) return undefined;
  return parseCanonicalIdentityId(String(Number(normalized)));
};
